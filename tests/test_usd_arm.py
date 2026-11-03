"""Checks usd_arm's USD-parsed kinematics against an explicitly computed robot, including a moved,
rotated (Y-up -> Z-up) and centimetre-scaled placement like the ones SimReady assets get.
    pip install usd-core numpy && python tests/test_usd_arm.py
"""
import math, sys
from pathlib import Path
import numpy as np
from pxr import Gf, Usd, UsdGeom, UsdPhysics
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "isaac"))
from usd_arm import UsdArm, _rot  # noqa: E402

# 6-axis industrial layout in the robot's own frame (metres): offsets of each joint from the previous one
OFFS = [(0, 0, 0.6), (0.3, 0, 0.4), (0, 0, 1.1), (0.25, 0, 0.2), (1.0, 0, 0), (0.2, 0, 0)]
AXES = ["Z", "Y", "Y", "X", "Y", "X"]
TOOL = 0.25
E = {"X": np.array([1., 0, 0]), "Y": np.array([0, 1., 0]), "Z": np.array([0, 0, 1.])}


def truth(q, place):
    """explicit FK in world: place @ chain"""
    T = place.copy()
    for o, a, qi in zip(OFFS, AXES, q):
        M = np.eye(4); M[:3, 3] = o; T = T @ M
        Rm = np.eye(4); Rm[:3, :3] = _rot(E[a], qi); T = T @ Rm
    tip = T @ np.array([TOOL, 0, 0, 1.0])
    return tip[:3], T[:3, :3] @ E["X"]


def build(stage, unit=1.0):
    root = UsdGeom.Xform.Define(stage, "/World/Robot")
    UsdPhysics.ArticulationRootAPI.Apply(root.GetPrim())
    pos = np.zeros(3); bodies = ["/World/Robot/base_link"]
    UsdGeom.Xform.Define(stage, bodies[0])
    for i, o in enumerate(OFFS):
        pos = pos + np.array(o)
        b = f"/World/Robot/link_{i + 1}"
        x = UsdGeom.Xform.Define(stage, b); x.AddTranslateOp().Set(Gf.Vec3d(*(pos / unit))); bodies.append(b)
    for b in bodies:
        UsdPhysics.RigidBodyAPI.Apply(stage.GetPrimAtPath(b))
    fj = UsdPhysics.FixedJoint.Define(stage, "/World/Robot/joints/root_joint"); fj.CreateBody1Rel().SetTargets([bodies[0]])
    prev = np.zeros(3)
    for i, (o, a) in enumerate(zip(OFFS, AXES)):
        j = UsdPhysics.RevoluteJoint.Define(stage, f"/World/Robot/joints/joint_{i + 1}")
        j.CreateBody0Rel().SetTargets([bodies[i]]); j.CreateBody1Rel().SetTargets([bodies[i + 1]])
        j.CreateAxisAttr(a); j.CreateLocalPos0Attr(Gf.Vec3f(*(np.array(o) / unit))); j.CreateLocalPos1Attr(Gf.Vec3f(0, 0, 0))
        j.CreateLowerLimitAttr(-170); j.CreateUpperLimitAttr(170)
    return root


def place_matrix(t, yaw, yup_fix, s):
    """same op order as build_v8_factory.reference(): translate, rotateZ, rotateX(90), scale"""
    T = np.eye(4); T[:3, 3] = t
    Rz = np.eye(4); Rz[:3, :3] = _rot(E["Z"], yaw)
    Rx = np.eye(4); Rx[:3, :3] = _rot(E["X"], math.pi / 2) if yup_fix else np.eye(3)
    S = np.diag([s, s, s, 1.0])
    return T @ Rz @ Rx @ S


def run(case, t, yaw, yup, unit):
    stage = Usd.Stage.CreateInMemory()
    root = build(stage, unit)
    x = UsdGeom.Xformable(root); x.AddTranslateOp().Set(Gf.Vec3d(*t)); x.AddRotateZOp().Set(math.degrees(yaw))
    if yup: x.AddRotateXOp().Set(90.0)
    x.AddScaleOp().Set(Gf.Vec3f(unit, unit, unit))
    # in the Y-up case the authored robot is "lying down"; the robot frame is place @ (robot authored in its own axes)
    P = place_matrix(np.array(t), yaw, yup, 1.0)
    arm = UsdArm(stage, "/World/Robot", tool_length=TOOL)
    rng = np.random.default_rng(0)
    worst_fk, worst_ik = 0.0, 0.0
    for _ in range(40):
        q = rng.uniform(-1.2, 1.2, 6)
        p_true, a_true = truth(q, P)
        p, a = arm.fk(q)
        worst_fk = max(worst_fk, np.linalg.norm(p - p_true), np.linalg.norm(a - a_true))
    for _ in range(25):
        q = rng.uniform(-0.9, 0.9, 6)
        p_t, a_t = truth(q, P)
        arm.q = np.zeros(6)
        sol = arm.solve(p_t, down=a_t, iters=200)
        p, a = arm.fk(sol)
        worst_ik = max(worst_ik, np.linalg.norm(p - p_t))
    arm.command(sol)
    deg = stage.GetPrimAtPath("/World/Robot/joints/joint_1").GetAttribute("drive:angular:physics:targetPosition").Get()
    assert abs(deg - math.degrees(sol[0])) < 1e-3
    print(f"{case:34s} FK err {worst_fk:.2e} m   IK err {worst_ik * 1000:.2f} mm   reach {arm.reach():.2f} m")
    assert worst_fk < 1e-6, worst_fk
    assert worst_ik < 5e-3, worst_ik


run("Z-up, at origin, metres", (0, 0, 0), 0.0, False, 1.0)
run("Z-up, moved + yawed, metres", (12.0, -4.0, 0.6), 0.7, False, 1.0)
run("Y-up fixed, moved, centimetres", (-3.0, 8.0, 0.0), -1.1, True, 0.01)
print("usd_arm kinematics test passed")
