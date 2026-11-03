"""Smoke test without a GPU: runs isaac/build_v8_factory.py against a real OpenUSD stage (usd-core),
with only the Isaac Sim runtime stubbed and fake SimReady-style assets (Y-up, centimetres).
    pip install usd-core && python tests/smoke_build.py
"""
import json, runpy, sys, tempfile
import numpy as np
from pathlib import Path
from unittest.mock import MagicMock
from pxr import Gf, Usd, UsdGeom, UsdPhysics

ROOT = Path(__file__).resolve().parents[1]
tmp = Path(tempfile.mkdtemp())
specs = {"conveyor": (300, 80, 60), "car_frame": (450, 140, 180), "crate": (60, 35, 40), "small_load_carrier": (60, 28, 40),
         "fence": (240, 200, 5), "parts_cart": (100, 90, 60), "box": (60, 40, 40), "air_compressor": (150, 120, 80),
         "safety_gate": (200, 120, 5), "tire": (68, 68, 24), "wheel_rim": (45, 45, 20), "rack": (270, 300, 110), "tire_rack": (200, 180, 60),
         "lift_table": (120, 80, 70), "crankshaft": (70, 18, 18), "flywheel": (35, 35, 5), "piston": (9, 12, 9), "cylinder_head": (60, 15, 22),
         "exhaust_manifold": (55, 12, 12), "intake_manifold": (55, 18, 25), "oil_pan": (65, 15, 35), "timing_chain": (30, 45, 2),
         "water_pump": (18, 18, 14), "transmission": (80, 40, 45), "door_front": (110, 115, 15), "door_rear": (100, 110, 15),
         "fender_front": (120, 60, 50), "hood": (150, 8, 160), "bumper_front": (40, 50, 185), "bumper_rear": (35, 50, 185)}
man = {"assets": {}}
for k, (x, y, z) in specs.items():
    p = tmp / k / f"{k}.usda"; p.parent.mkdir(parents=True)
    st = Usd.Stage.CreateNew(str(p))
    UsdGeom.SetStageUpAxis(st, UsdGeom.Tokens.y); UsdGeom.SetStageMetersPerUnit(st, 0.01)
    root = UsdGeom.Xform.Define(st, "/Root"); st.SetDefaultPrim(root.GetPrim())
    UsdPhysics.RigidBodyAPI.Apply(root.GetPrim())          # SimReady props carry rigid bodies
    c = UsdGeom.Cube.Define(st, "/Root/Geo"); c.CreateSizeAttr(1.0)
    api = UsdGeom.XformCommonAPI(c); api.SetScale(Gf.Vec3f(x, y, z)); api.SetTranslate(Gf.Vec3d(50, y / 2 + 10, -30))
    st.Save(); man["assets"][k] = str(p)

# synthetic articulated arms (Y-up, cm, joints like the SimReady robots): heavy ~3.4 m reach, cobot ~1.35 m
def make_robot(name, k):
    offs = [(0, 0.6, 0), (0.3, 0.4, 0), (0, 1.1, 0), (0.25, 0.2, 0), (1.0, 0, 0), (0.2, 0, 0)]  # Y-up
    axes = ["Y", "Z", "Z", "X", "Z", "X"]
    p = tmp / name / f"{name}.usda"; p.parent.mkdir(parents=True)
    st = Usd.Stage.CreateNew(str(p))
    UsdGeom.SetStageUpAxis(st, UsdGeom.Tokens.y); UsdGeom.SetStageMetersPerUnit(st, 0.01)
    root = UsdGeom.Xform.Define(st, "/arm"); st.SetDefaultPrim(root.GetPrim())
    bodies, pos = ["/arm/base_link"], [0.0, 0.0, 0.0]
    b = UsdGeom.Xform.Define(st, bodies[0]); UsdGeom.Cube.Define(st, bodies[0] + "/g").CreateSizeAttr(40 * k)
    for i, o in enumerate(offs):
        pos = [pos[j] + o[j] * 100 * k for j in range(3)]
        bp = f"/arm/link_{i + 1}"; x = UsdGeom.Xform.Define(st, bp); x.AddTranslateOp().Set(Gf.Vec3d(*pos)); bodies.append(bp)
        UsdGeom.Cube.Define(st, bp + "/g").CreateSizeAttr(15 * k)
    for bp in bodies:
        UsdPhysics.RigidBodyAPI.Apply(st.GetPrimAtPath(bp))
    fj = UsdPhysics.FixedJoint.Define(st, "/arm/joints/root_joint"); fj.CreateBody1Rel().SetTargets([bodies[0]])
    for i, (o, a) in enumerate(zip(offs, axes)):
        j = UsdPhysics.RevoluteJoint.Define(st, f"/arm/joints/joint_{i + 1}")
        j.CreateBody0Rel().SetTargets([bodies[i]]); j.CreateBody1Rel().SetTargets([bodies[i + 1]])
        j.CreateAxisAttr(a); j.CreateLocalPos0Attr(Gf.Vec3f(*[v * 100 * k for v in o])); j.CreateLocalPos1Attr(Gf.Vec3f(0, 0, 0))
        j.CreateLowerLimitAttr(-175); j.CreateUpperLimitAttr(175)
        UsdPhysics.DriveAPI.Apply(j.GetPrim(), "angular").CreateTargetPositionAttr(0.0)
    st.Save(); return str(p)
man["assets"]["robot_heavy"] = make_robot("robot_heavy", 1.0)
man["assets"]["robot_cobot"] = make_robot("robot_cobot", 0.5)
(tmp / "manifest.json").write_text(json.dumps(man))

stage = Usd.Stage.CreateInMemory()
for m in ["isaacsim", "isaacsim.core", "isaacsim.core.api", "isaacsim.core.utils", "isaacsim.core.utils.stage", "isaacsim.core.utils.extensions",
          "isaacsim.storage", "isaacsim.storage.native", "isaacsim.core.prims", "isaacsim.core.utils.types", "omni", "omni.usd"]:
    sys.modules[m] = MagicMock()
sys.modules["omni"].usd = sys.modules["omni.usd"]
sys.modules["omni.usd"].get_context.return_value.get_stage.return_value = stage
def add_ref(usd_path, prim_path):
    p = stage.DefinePrim(prim_path, "Xform"); p.GetReferences().AddReference(usd_path); return p
sys.modules["isaacsim.core.utils.stage"].add_reference_to_stage = add_ref
sys.modules["isaacsim.storage.native"].get_assets_root_path = lambda: None
app = MagicMock(); n = {"i": 0}
def running():
    n["i"] += 1; return n["i"] < 40
app.is_running = running
sys.modules["isaacsim"].SimulationApp = lambda *a, **k: app
w = MagicMock(); w.is_playing.return_value = True; w.get_physics_dt.return_value = 0.5
sys.modules["isaacsim.core.api"].World = lambda *a, **k: w
sys.argv = ["x", "--offline", "--assets", str(tmp / "manifest.json"), "--manifest", str(tmp / "resolved.json")]
runpy_globals = {}
_orig_exit = sys.exit
sys.exit = lambda code=0: (_ for _ in ()).throw(SystemExit(code))
try:
    runpy_globals = runpy.run_path(str(ROOT / "isaac" / "build_v8_factory.py"), run_name="__main__")
except SystemExit as e:
    assert not e.code, e.code

cache = UsdGeom.BBoxCache(Usd.TimeCode.Default(), [UsdGeom.Tokens.default_])
def size(p):
    r = cache.ComputeWorldBound(stage.GetPrimAtPath(p)).ComputeAlignedRange(); return r.GetMin(), r.GetSize()
fence = next(p.GetName() for p in stage.GetPrimAtPath("/World/V8Plant/Decor").GetChildren() if p.GetName().startswith("fence"))
checks = {"V8Line/top_0": (3.0, 0.8), f"Decor/{fence}": (2.4, 2.0), "CarLine/Car_00/Shell/frame": (4.4, 1.37), "CarLine/Car_00/Wheels/w0": (0.68, 0.68)}
for rel, (L, H) in checks.items():
    mn, sz = size("/World/V8Plant/" + rel)
    assert abs(max(sz[0], sz[1]) - L) < 0.02 and abs(sz[2] - H) < 0.03, (rel, tuple(sz))
    print(f"ok  {rel:30s} {sz[0]:.2f} x {sz[1]:.2f} x {sz[2]:.2f} m")
# robots: SimReady path used, every station reachable, drive targets written
g = runpy_globals
rb = [r for r in g["robots"] if r.mode == "usd"]
assert len(rb) == len(g["robots"]) == 22, (len(rb), len(g["robots"]))
worst = max(rb, key=lambda r: r.key_err)
for r in rb:
    assert r.key_err < 0.01, (r.name, r.key_err)        # pick / place points are hit
    assert r.max_step < 45, (r.name, r.max_step)         # no configuration flips between samples
print(f"ok  {len(rb)} SimReady-path robots, worst pick/place error {worst.key_err * 1000:.1f} mm ({worst.name}),"
      f" worst joint step {max(r.max_step for r in rb):.0f} deg")
d = stage.GetPrimAtPath("/World/V8Plant/Robots/ST30/joints/joint_2").GetAttribute("drive:angular:physics:targetPosition").Get()
assert d is not None and abs(d) > 1e-3, d
# props: rigid bodies disabled; robots: not
assert stage.GetPrimAtPath("/World/V8Plant/V8Line/top_0").GetAttribute("physics:rigidBodyEnabled").Get() is False
assert not stage.GetPrimAtPath("/World/V8Plant/Robots/ST30/link_3").GetAttribute("physics:rigidBodyEnabled").Get() is False
# SimReady engine parts inside the stage groups
for part in ["Crank/crankshaft", "PistonsL/p0", "HeadR/head", "Intake/manifold", "Covers/oil_pan"]:
    assert stage.GetPrimAtPath(f"/World/V8Plant/V8Line/Pallet_00/Engine/{part}").IsValid(), part
assert stage.GetPrimAtPath("/World/V8Plant/CarLine/Car_00/Closures/door_front_R").IsValid()
print("prims:", len(list(stage.Traverse())), "— first build passed")

# second launch: robot placement + trajectories must come from the cache, identically
import time
first = {r.name: (r.base.copy(), r.Q.copy()) for r in rb}
stage2 = Usd.Stage.CreateInMemory()
stage = stage2
sys.modules["omni.usd"].get_context.return_value.get_stage.return_value = stage2
n["i"] = 0
t0 = time.time()
try:
    g2 = runpy.run_path(str(ROOT / "isaac" / "build_v8_factory.py"), run_name="__main__")
except SystemExit as e:
    assert not e.code, e.code
dt = time.time() - t0
for r in g2["robots"]:
    b, Q = first[r.name]
    assert np.allclose(r.base, b, atol=1e-6) and np.allclose(r.Q, Q, atol=1e-9), r.name
print(f"ok  second launch reused the robot cache ({dt:.1f} s) — smoke test passed")
