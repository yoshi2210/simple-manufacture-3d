"""Smoke test without a GPU: runs isaac/build_v8_factory.py against a real OpenUSD stage (usd-core),
with only the Isaac Sim runtime stubbed and fake SimReady-style assets (Y-up, centimetres).
    pip install usd-core && python tests/smoke_build.py
"""
import json, runpy, sys, tempfile
from pathlib import Path
from unittest.mock import MagicMock
from pxr import Gf, Usd, UsdGeom

ROOT = Path(__file__).resolve().parents[1]
tmp = Path(tempfile.mkdtemp())
specs = {"conveyor": (300, 80, 60), "car_frame": (450, 140, 180), "crate": (60, 35, 40), "fence": (240, 200, 5),
         "parts_cart": (100, 90, 60), "box": (60, 40, 40), "air_compressor": (150, 120, 80), "safety_gate": (200, 120, 5), "tire": (68, 68, 24)}
man = {"assets": {}}
for k, (x, y, z) in specs.items():
    p = tmp / k / f"{k}.usda"; p.parent.mkdir(parents=True)
    st = Usd.Stage.CreateNew(str(p))
    UsdGeom.SetStageUpAxis(st, UsdGeom.Tokens.y); UsdGeom.SetStageMetersPerUnit(st, 0.01)
    root = UsdGeom.Xform.Define(st, "/Root"); st.SetDefaultPrim(root.GetPrim())
    c = UsdGeom.Cube.Define(st, "/Root/Geo"); c.CreateSizeAttr(1.0)
    api = UsdGeom.XformCommonAPI(c); api.SetScale(Gf.Vec3f(x, y, z)); api.SetTranslate(Gf.Vec3d(50, y / 2 + 10, -30))
    st.Save(); man["assets"][k] = str(p)
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
    n["i"] += 1; return n["i"] < 60
app.is_running = running
sys.modules["isaacsim"].SimulationApp = lambda *a, **k: app
w = MagicMock(); w.is_playing.return_value = True; w.get_physics_dt.return_value = 0.5
sys.modules["isaacsim.core.api"].World = lambda *a, **k: w
sys.argv = ["x", "--offline", "--assets", str(tmp / "manifest.json"), "--manifest", str(tmp / "resolved.json")]
try:
    runpy.run_path(str(ROOT / "isaac" / "build_v8_factory.py"), run_name="__main__")
except SystemExit as e:
    assert e.code == 0, e.code

cache = UsdGeom.BBoxCache(Usd.TimeCode.Default(), [UsdGeom.Tokens.default_])
def size(p):
    r = cache.ComputeWorldBound(stage.GetPrimAtPath(p)).ComputeAlignedRange(); return r.GetMin(), r.GetSize()
fence = next(p.GetName() for p in stage.GetPrimAtPath("/World/V8Plant/Decor").GetChildren() if p.GetName().startswith("fence"))
checks = {"V8Line/top_0": (3.0, 0.8), f"Decor/{fence}": (2.4, 2.0), "CarLine/Car_00/Shell/frame": (4.4, 1.37), "CarLine/Car_00/Wheels/w0": (0.68, 0.68)}
for rel, (L, H) in checks.items():
    mn, sz = size("/World/V8Plant/" + rel)
    assert abs(max(sz[0], sz[1]) - L) < 0.02 and abs(sz[2] - H) < 0.03, (rel, tuple(sz))
    print(f"ok  {rel:30s} {sz[0]:.2f} x {sz[1]:.2f} x {sz[2]:.2f} m")
print("prims:", len(list(stage.Traverse())), "— smoke test passed")
