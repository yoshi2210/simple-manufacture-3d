"""Inspect the REAL SimReady packages fetched by tools/fetch_simready.py (no GPU, usd-core only).

For every asset: up axis, units, size after normalisation, physics/variant setup.
For every robot: the joint chain usd_arm reads, limits, reach, and an FK->IK round trip on the real USD.
Writes a Markdown report (also to $GITHUB_STEP_SUMMARY when run in GitHub Actions).
    python tools/fetch_simready.py && python tests/real_assets_check.py
"""
import json, math, os, sys
from pathlib import Path
import numpy as np
from pxr import Usd, UsdGeom, UsdPhysics
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "isaac"))
from usd_arm import UsdArm  # noqa: E402

man = json.loads((ROOT / "assets" / "simready" / "manifest.json").read_text())["assets"]
lines = ["# SimReady real-asset check", "", "| category | up | m/unit | size (m, after unit fix) | rigid bodies | physics variants |", "|---|---|---|---|---|---|"]
robots, fails = [], []
for cat, path in sorted(man.items()):
    try:
        st = Usd.Stage.Open(path)
        up, mpu = UsdGeom.GetStageUpAxis(st), UsdGeom.GetStageMetersPerUnit(st)
        root = st.GetDefaultPrim() or next(iter(st.GetPseudoRoot().GetChildren()))
        r = UsdGeom.BBoxCache(Usd.TimeCode.Default(), [UsdGeom.Tokens.default_, UsdGeom.Tokens.render]).ComputeWorldBound(root).ComputeAlignedRange()
        sz = [round(v * mpu, 3) for v in r.GetSize()] if not r.IsEmpty() else None
        rb = sum(1 for p in Usd.PrimRange(root) if p.HasAPI(UsdPhysics.RigidBodyAPI))
        vs = {n: root.GetVariantSets().GetVariantSet(n).GetVariantNames() for n in root.GetVariantSets().GetNames()}
        lines.append(f"| {cat} | {up} | {mpu} | {sz} | {rb} | {vs or '-'} |")
        if cat.startswith("robot_"):
            robots.append((cat, path))
    except Exception as e:
        lines.append(f"| {cat} | ERROR | | {type(e).__name__}: {e} | | |")
        fails.append(cat)

lines += ["", "## Robots (usd_arm on the real USD)", ""]
for cat, path in robots:
    st = Usd.Stage.CreateInMemory()
    UsdGeom.SetStageUpAxis(st, UsdGeom.Tokens.z); UsdGeom.SetStageMetersPerUnit(st, 1.0)
    src = Usd.Stage.Open(path)
    up, mpu = UsdGeom.GetStageUpAxis(src), UsdGeom.GetStageMetersPerUnit(src)
    x = UsdGeom.Xform.Define(st, "/World/R")
    x.GetPrim().GetReferences().AddReference(path)
    if up == UsdGeom.Tokens.y:
        x.AddRotateXOp().Set(90.0)
    if abs(mpu - 1) > 1e-9:
        x.AddScaleOp().Set((mpu, mpu, mpu))
    try:
        arm = UsdArm(st, "/World/R", tool_length=0.2)
        names = [jp.GetName() for jp, _, _ in arm.chain]
        rng = np.random.default_rng(1)
        worst = 0.0
        for _ in range(15):
            q = rng.uniform(arm.lo * 0.5, arm.hi * 0.5)
            p, a = arm.fk(q)
            arm.q = np.zeros(arm.n)
            sol = arm.solve_best(p, down=a, seeds=8)
            worst = max(worst, float(np.linalg.norm(arm.fk(sol)[0] - p)))
        lines.append(f"- **{cat}** `{Path(path).name}`: {arm.n} joints {names}, limits "
                     f"{[f'{math.degrees(l):.0f}..{math.degrees(h):.0f}' for l, h in zip(arm.lo, arm.hi)]} deg, "
                     f"reach {arm.reach():.2f} m, base z {arm.points[0][2]:.2f} m, IK round-trip worst {worst * 1000:.1f} mm")
        if worst > 0.01:
            fails.append(f"{cat} IK {worst * 1000:.0f} mm")
    except Exception as e:
        lines.append(f"- **{cat}**: usd_arm FAILED — {type(e).__name__}: {e}")
        joints = [(p.GetPath(), p.GetTypeName()) for p in Usd.PrimRange(st.GetPrimAtPath("/World/R")) if p.IsA(UsdPhysics.Joint)]
        lines.append(f"  - joints found: {joints[:12]}")
        fails.append(cat)

report = "\n".join(lines + ["", f"**failures:** {fails or 'none'}"])
print(report)
(ROOT / "simready-real-report.md").write_text(report)
if os.environ.get("GITHUB_STEP_SUMMARY"):
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
        f.write(report + "\n")
sys.exit(1 if fails else 0)
