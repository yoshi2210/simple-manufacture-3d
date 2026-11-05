"""
build_v8_factory.py
===================
V8 エンジン & 自動車組立工場を NVIDIA Isaac Sim 上に構築し、ライブで動かすスタンドアロンスクリプト。

* 設備アセットは NVIDIA SimReady（Hugging Face 上の無料 OpenUSD ライブラリ, CC-BY-4.0）を使います。
  先に tools/fetch_simready.py で必要なフォルダだけを取得し、assets/simready/manifest.json を読みます。
  manifest に無いカテゴリは `simready-search` の自然言語検索を試します（--offline で無効）。
* 見つからないカテゴリは Isaac Sim 同梱アセット（UR10）か、スクリプト内の手続き生成ジオメトリで代替します。
* レイアウトとタイミングはブラウザ版デジタルツイン（index.html）と同一です。
    - V8 組立ライン: 周回パレットコンベア 24 台 / ST10〜ST80 組付けロボット / ST90 検査 / ST100 払出し
    - ホットテスト → エンジン搬送コンベア → マリッジ（エンジン搭載）
    - ボディ溶接 8 台 → 塗装ブース → オーバーヘッドハンガー → タイヤ・ガラス装着 → 完成車ヤード
    - AMR が部品を巡回搬送

実行例（Isaac Sim 5.x / 6.x）:
    ./python.sh -m pip install simready-search
    ./python.sh build_v8_factory.py                  # GUI で起動してライブ再生
    ./python.sh build_v8_factory.py --offline        # 検索せず代替アセットだけで構築
    ./python.sh build_v8_factory.py --save plant.usd --headless --frames 1   # USD に書き出すだけ

座標系: Isaac Sim 標準の Z-up / メートル。X = ラインの流れ方向。
"""
import argparse
import json
import math
import os
import sys

parser = argparse.ArgumentParser(description="V8 engine plant built from NVIDIA SimReady assets")
parser.add_argument("--headless", action="store_true")
parser.add_argument("--offline", action="store_true", help="SimReady 検索をスキップして代替アセットのみ使用")
parser.add_argument("--endpoint", default=os.environ.get("SIMREADY_ENDPOINT", "https://nvidia-simready-central.hf.space"),
                    help="simready-search のサービスエンドポイント")
parser.add_argument("--speed", type=float, default=1.0, help="ライン速度の倍率")
parser.add_argument("--frames", type=int, default=0, help="0 = ウィンドウを閉じるまで実行")
parser.add_argument("--save", default="", help="構築後のステージを書き出す .usd パス")
parser.add_argument("--manifest", default="simready_manifest.json", help="解決したアセット一覧の出力先")
parser.add_argument("--assets", default=str(__import__("pathlib").Path(__file__).resolve().parents[1] / "assets" / "simready" / "manifest.json"),
                    help="tools/fetch_simready.py が書き出した manifest.json")
parser.add_argument("--livestream", action="store_true", help="ヘッドレス + WebRTC ライブストリーム（クラウド GPU 向け）")
parser.add_argument("--no-axis-fix", action="store_true", help="Y-up アセットの自動回転を無効化")
parser.add_argument("--plant", default=str(__import__("pathlib").Path(__file__).resolve().parents[1] / "data" / "plant.json"),
                    help="BOM / 工程表（ブラウザ版と共通）")
parser.add_argument("--engine-detail", choices=["simready", "proxy"], default="simready",
                    help="エンジン部品を SimReady 実モデルにするか、軽量な代替形状にするか")
parser.add_argument("--robots", choices=["simready", "ur10"], default="simready",
                    help="SimReady の Comau / FANUC を使うか、Isaac 同梱の UR10 を使うか")
args, _ = parser.parse_known_args()

from isaacsim import SimulationApp  # noqa: E402

_cfg = {"headless": args.headless or args.livestream, "width": 1920, "height": 1080}
if args.livestream:
    _cfg.update({"window_width": 1920, "window_height": 1080, "hide_ui": False, "display_options": 3286})
simulation_app = SimulationApp(_cfg)
if args.livestream:
    from isaacsim.core.utils.extensions import enable_extension
    simulation_app.set_setting("/app/window/drawMouse", True)
    enable_extension("omni.kit.livestream.webrtc")
    print("[V8Plant] livestream enabled — connect with the Isaac Sim WebRTC Streaming Client")

import numpy as np  # noqa: E402
import omni.usd  # noqa: E402
from pxr import Gf, Sdf, Usd, UsdGeom, UsdLux, UsdPhysics, UsdShade  # noqa: E402
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from usd_arm import UsdArm  # noqa: E402
from isaacsim.core.api import World  # noqa: E402
from isaacsim.core.utils.stage import add_reference_to_stage  # noqa: E402

try:
    from isaacsim.storage.native import get_assets_root_path
except ImportError:  # older 4.x layout
    from isaacsim.core.utils.nucleus import get_assets_root_path

try:
    from isaacsim.core.prims import SingleArticulation
except ImportError:
    from isaacsim.core.prims import Articulation as SingleArticulation
from isaacsim.core.utils.types import ArticulationAction  # noqa: E402

# ------------------------------------------------------------------ timing / layout (shared with index.html)
with open(args.plant, encoding="utf-8") as _f:
    PLANT = json.load(_f)
_SCALE = PLANT["meta"]["demo_time_scale"]
C, IDX = PLANT["meta"]["takt_s"] / _SCALE, PLANT["meta"]["transfer_s"] / _SCALE   # demo cycle / index-move (s)
DW = C - IDX
G, R = 0.26, 0.68                      # grip / release fraction of a pick-and-place op
BELT_Y = 0.8                           # V8 conveyor top height
V8 = dict(x0=-22.0, S=48.0, R=3.5, zt=-5.0)
V8["zb"] = V8["zt"] - 2 * V8["R"]
V8["cz"] = V8["zt"] - V8["R"]
V8["L"] = 2 * V8["S"] + 2 * math.pi * V8["R"]
NP = 24
DP = V8["L"] / NP
CL = dict(x0=-58.0, sp=6.5, z=8.0)
Y_SKID, Y_HANG, Y_DIP, RAIL_Y = 0.35, 1.5, 0.75, 5.6
PAINTS = [(0.70, 0.07, 0.10), (0.11, 0.31, 0.57), (0.93, 0.93, 0.93), (0.08, 0.09, 0.10),
          (0.62, 0.65, 0.68), (0.83, 0.61, 0.09), (0.17, 0.43, 0.29), (0.42, 0.18, 0.55)]
BIW = (0.54, 0.56, 0.59)

def slot_s(q): return DP * (q + 0.5)
def slot_x(q): return V8["x0"] + slot_s(q)
def car_x(s): return CL["x0"] + s * CL["sp"]
XU = slot_x(9)
V8ST = PLANT["lines"]["v8"]["stations"]
VST = PLANT["lines"]["vehicle"]["stations"]


def P(x, up, zw):
    """layout coords (x, up, z_web) -> Isaac Z-up (x, y=-z_web, z=up)"""
    return Gf.Vec3d(float(x), float(-zw), float(up))


def smooth(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def win(x, a, b): return smooth((x - a) / (b - a))
def lerp(a, b, f): return a + (b - a) * f


def loop_pos(s):
    s %= V8["L"]
    x0, S, r, zt, zb, cz = V8["x0"], V8["S"], V8["R"], V8["zt"], V8["zb"], V8["cz"]
    A = math.pi * r
    if s < S:
        return x0 + s, zt, 0.0
    s -= S
    if s < A:
        f = s / r
        return x0 + S + r * math.sin(f), cz + r * math.cos(f), f
    s -= A
    if s < S:
        return x0 + S - s, zb, math.pi
    s -= S
    f = s / r
    return x0 - r * math.sin(f), cz - r * math.cos(f), math.pi + f


def clock(t):
    n = math.floor(t / C)
    ph = t - n * C
    moving = ph < IDX
    return n, moving, (smooth(ph / IDX) if moving else 1.0), (-1.0 if moving else (ph - IDX) / DW)


# ------------------------------------------------------------------ SimReady asset resolution
SIMREADY_QUERIES = {
    "robot_arm": "6-axis industrial robot arm with Isaac profile",
    "amr": "autonomous mobile robot AMR",
    "conveyor": "straight belt conveyor section",
    "rack": "industrial metal shelving rack",
    "bin": "plastic parts storage bin",
    "table": "industrial workbench table",
    "fence": "safety fence panel",
    "vehicle": "passenger car sedan",
    "tire": "car tire wheel",
    "engine": "car engine",
    "pallet": "pallet",
    "car_frame": "car body frame",
    "crate": "plastic crate",
    "parts_cart": "mobile parts cart",
    "box": "cardboard box",
    "air_compressor": "air compressor",
    "safety_gate": "safety gate",
}


class AssetResolver:
    def __init__(self, endpoint, offline, manifest_path):
        self.found, self.lib = {}, None
        self.nucleus = None
        self.local = {}
        if manifest_path and os.path.exists(manifest_path):
            with open(manifest_path, encoding="utf-8") as f:
                self.local = json.load(f).get("assets", {})
            print(f"[SimReady] {len(self.local)} local assets from {manifest_path}")
        else:
            print("[SimReady] no local manifest — run tools/fetch_simready.py first for offline-ready assets")
        if not offline:
            try:
                from simready.search import AssetLibrary
                self.lib = AssetLibrary()
                self.lib.add_service_source(endpoint)
                print(f"[SimReady] search source: {endpoint}")
            except Exception as e:  # package missing or network blocked
                print(f"[SimReady] search unavailable ({e}); using fallbacks")
        try:
            self.nucleus = get_assets_root_path()
        except Exception as e:
            print(f"[Isaac] assets root unavailable ({e})")

    def simready(self, key):
        if key in self.found:
            return self.found[key]
        path = self.local.get(key)
        if path is None and self.lib is not None and key in SIMREADY_QUERIES:
            try:
                from simready.search import SearchFilterLLMQuery
                hits = self.lib.search(include_all=[SearchFilterLLMQuery(SIMREADY_QUERIES[key])])
                for h in hits:
                    p = str(h.asset_path)
                    if p.lower().endswith((".usd", ".usda", ".usdc", ".usdz")):
                        path = p
                        break
            except Exception as e:
                print(f"[SimReady] '{key}' search failed: {e}")
        self.found[key] = path
        print(f"[SimReady] {key:10s} -> {path or '(fallback)'}")
        return path

    def robot(self):
        p = self.simready("robot_arm")
        if p:
            return p, "simready"
        if self.nucleus:
            return self.nucleus + "/Isaac/Robots/UniversalRobots/ur10/ur10.usd", "ur10"
        return None, "none"


# ------------------------------------------------------------------ stage helpers
world = World(stage_units_in_meters=1.0, physics_dt=1 / 60, rendering_dt=1 / 60)
stage = omni.usd.get_context().get_stage()
UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
UsdGeom.SetStageMetersPerUnit(stage, 1.0)
ROOT = "/World/V8Plant"
UsdGeom.Xform.Define(stage, ROOT)
_mats = {}


def material(rgb, metal=0.3, rough=0.5, emissive=None):
    key = (tuple(round(c, 3) for c in rgb), metal, rough, emissive)
    if key in _mats:
        return _mats[key]
    path = f"{ROOT}/Looks/M{len(_mats)}"
    m = UsdShade.Material.Define(stage, path)
    sh = UsdShade.Shader.Define(stage, path + "/S")
    sh.CreateIdAttr("UsdPreviewSurface")
    sh.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*rgb))
    sh.CreateInput("metallic", Sdf.ValueTypeNames.Float).Set(metal)
    sh.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(rough)
    if emissive:
        sh.CreateInput("emissiveColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*emissive))
    m.CreateSurfaceOutput().ConnectToSource(sh.ConnectableAPI(), "surface")
    _mats[key] = (m, sh)
    return _mats[key]


MAT = dict(
    alu=material((0.62, 0.64, 0.67), 0.7, 0.4), dark=material((0.23, 0.24, 0.27), 0.5, 0.5),
    steel=material((0.6, 0.63, 0.66), 0.9, 0.3), red=material((0.70, 0.07, 0.10), 0.25, 0.42),
    black=material((0.09, 0.1, 0.11), 0.2, 0.6), rust=material((0.48, 0.36, 0.31), 0.6, 0.5),
    frame=material((0.18, 0.44, 0.70), 0.4, 0.45), yellow=material((0.95, 0.76, 0.19), 0.2, 0.5),
    grey=material((0.36, 0.39, 0.42), 0.4, 0.55), floor=material((0.30, 0.32, 0.35), 0.05, 0.85),
    glass=material((0.12, 0.17, 0.22), 0.1, 0.05), white=material((0.9, 0.9, 0.91), 0.1, 0.5),
    orange=material((0.94, 0.54, 0.14), 0.35, 0.42),
)


class Mover:
    """Xform with cached translate / rotateZ ops for cheap per-frame updates."""

    def __init__(self, path, pos=(0, 0, 0), yaw=0.0):
        self.x = UsdGeom.Xform.Define(stage, path)
        self.path = path
        self.t = self.x.AddTranslateOp()
        self.r = self.x.AddRotateZOp()
        self.vis = True
        self.set(pos, yaw)

    def set(self, pos, yaw=0.0):
        self.t.Set(Gf.Vec3d(*pos))
        self.r.Set(math.degrees(yaw))

    def show(self, v):
        if v != self.vis:
            img = UsdGeom.Imageable(self.x.GetPrim())
            img.MakeVisible() if v else img.MakeInvisible()
            self.vis = v


def cube(path, size, pos, mat, rot=(0, 0, 0)):
    c = UsdGeom.Cube.Define(stage, path)
    c.CreateSizeAttr(1.0)
    x = UsdGeom.XformCommonAPI(c)
    x.SetTranslate(Gf.Vec3d(*pos))
    x.SetRotate(Gf.Vec3f(*rot))
    x.SetScale(Gf.Vec3f(*size))
    UsdShade.MaterialBindingAPI(c.GetPrim()).Bind(mat[0])
    return c


def cyl(path, r, h, pos, mat, axis="Z"):
    c = UsdGeom.Cylinder.Define(stage, path)
    c.CreateRadiusAttr(r)
    c.CreateHeightAttr(h)
    c.CreateAxisAttr(axis)
    UsdGeom.XformCommonAPI(c).SetTranslate(Gf.Vec3d(*pos))
    UsdShade.MaterialBindingAPI(c.GetPrim()).Bind(mat[0])
    return c


def bx(path, w, h, d, x, y, z, mat, rot_x=0.0):
    """web-style box (w along x, h up, d along z_web) placed at web coords."""
    p = P(x, y, z)
    return cube(path, (w, d, h), (p[0], p[1], p[2]), mat, (rot_x, 0, 0))


_meta_cache = {}


def asset_meta(usd):
    """(is Y-up, metersPerUnit) of an asset's root layer."""
    if usd not in _meta_cache:
        try:
            st = Usd.Stage.Open(usd, load=Usd.Stage.LoadNone)
            _meta_cache[usd] = (UsdGeom.GetStageUpAxis(st) == UsdGeom.Tokens.y, UsdGeom.GetStageMetersPerUnit(st) or 1.0)
        except Exception:
            _meta_cache[usd] = (False, 1.0)
    return _meta_cache[usd]


def world_range(prim):
    cache = UsdGeom.BBoxCache(Usd.TimeCode.Default(), [UsdGeom.Tokens.default_, UsdGeom.Tokens.render])
    return cache.ComputeWorldBound(prim).ComputeAlignedRange()


def bbox_size(prim):
    r = world_range(prim)
    return r.GetSize() if not r.IsEmpty() else Gf.Vec3d(1, 1, 1)


def _op(x, kind, suffix=""):
    """Add an xform op, matching the precision of an attribute the asset may already author (e.g. double3 scale)."""
    name = f"xformOp:{kind}" + (f":{suffix}" if suffix else "")
    attr = x.GetPrim().GetAttribute(name)
    prec = UsdGeom.XformOp.PrecisionDouble if attr and "double" in str(attr.GetTypeName()) else (
        UsdGeom.XformOp.PrecisionFloat if attr else None)
    add = {"translate": x.AddTranslateOp, "rotateX": x.AddRotateXOp, "rotateY": x.AddRotateYOp,
           "rotateZ": x.AddRotateZOp, "scale": x.AddScaleOp}[kind]
    if prec is None:
        return add(opSuffix=suffix) if suffix else add()
    return add(precision=prec, opSuffix=suffix) if suffix else add(precision=prec)


def _v3(op, v):
    """Set a 3-vector op with the Gf type its attribute expects."""
    op.Set((Gf.Vec3d if "double" in str(op.GetAttr().GetTypeName()) else Gf.Vec3f)(*v))


def reference(path, usd, pos, yaw=0.0, fit=None, force_fit=False, snap="floor", tilt_x=0.0, tilt_y=0.0, long_axis=None,
              units=False, fit_axis="xy"):
    """Reference a SimReady USD and normalise it.

    - Y-up -> Z-up, and (units=True) metersPerUnit -> metres, sanity-checked against the resulting size
    - fit: expected largest horizontal size (m); rescale when off by >2.5x (unit mismatch), or always if force_fit
    - long_axis="x": turn the asset so its longest horizontal side runs along X
    - tilt_x / tilt_y: degrees about world X / Y (applied after the yaw / alignment)
    - fit_axis: which extent `fit` refers to: "xy" largest horizontal, "z" height, "max" largest of all
    - snap: "floor" centre XY and sit on pos.z | "center" centre XYZ on pos | "top" centre XY, top at pos.z
            | "base" only sit on pos.z | None
    """
    add_reference_to_stage(usd_path=usd, prim_path=path)
    prim = stage.GetPrimAtPath(path)
    x = UsdGeom.Xformable(prim)
    x.ClearXformOpOrder()
    t = _op(x, "translate")
    _v3(t, pos)
    if tilt_x:
        _op(x, "rotateX", "tilt").Set(float(tilt_x))
    if tilt_y:
        _op(x, "rotateY", "tilt").Set(float(tilt_y))
    rz = _op(x, "rotateZ")
    rz.Set(math.degrees(yaw))
    y_up, mpu = asset_meta(usd)
    if y_up and not args.no_axis_fix:
        _op(x, "rotateX", "upAxis").Set(90.0)
    sc = _op(x, "scale")
    _v3(sc, (1, 1, 1))
    if units and abs(mpu - 1.0) > 1e-6:
        _v3(sc, (mpu, mpu, mpu))
        m = max(bbox_size(prim))
        if not (0.3 < m < 8.0):  # the runtime already converted units -> undo
            _v3(sc, (1, 1, 1))
    if long_axis == "x":
        sz = bbox_size(prim)
        if sz[1] > sz[0] * 1.15:
            rz.Set(math.degrees(yaw) + 90.0)
    if fit:
        size = bbox_size(prim)
        m = {"xy": max(size[0], size[1]), "z": size[2], "max": max(size)}[fit_axis]
        if m > 1e-6:
            k = fit / m
            if force_fit or not (0.4 < k < 2.5):
                cur = sc.Get()
                _v3(sc, (cur[0] * k, cur[1] * k, cur[2] * k))
    if snap:
        r = world_range(prim)
        if not r.IsEmpty():
            c, lo = r.GetMidpoint(), r.GetMin()
            dx, dy = (pos[0] - c[0], pos[1] - c[1]) if snap in ("floor", "center", "top") else (0.0, 0.0)
            dz = pos[2] - {"center": c[2], "top": r.GetMax()[2]}.get(snap, lo[2])
            _v3(t, (pos[0] + dx, pos[1] + dy, pos[2] + dz))
    return prim


def enable_robot_variants(prim):
    """SimReady robots carry variant sets such as Physics:{None,PhysX} or PhysX:{Disabled,Enabled}, Robot:{None,Robot}.
    Select the PhysX / robot-schema variants explicitly so the joints and drives are active."""
    vsets = prim.GetVariantSets()
    for name in vsets.GetNames():
        vs, lname = vsets.GetVariantSet(name), name.lower()
        names = vs.GetVariantNames()
        pick = None
        if lname in ("physics", "physx"):
            pick = next((v for v in names if v.lower() in ("physx", "enabled", "physics")), None)
        elif lname == "robot":
            pick = next((v for v in names if v.lower() == "robot"), None)
        elif lname in ("newton", "mujoco"):
            pick = next((v for v in names if v.lower() == "disabled"), None)
        if pick:
            vs.SetVariantSelection(pick)


_size_cache = {}


def bbox_size_of(usd):
    """Native size of an asset (metres, its own up axis), for orientation decisions."""
    if usd not in _size_cache:
        try:
            st = Usd.Stage.Open(usd)
            root = st.GetDefaultPrim() or next(iter(st.GetPseudoRoot().GetChildren()))
            r = UsdGeom.BBoxCache(Usd.TimeCode.Default(), [UsdGeom.Tokens.default_, UsdGeom.Tokens.render]).ComputeWorldBound(root).ComputeAlignedRange()
            _size_cache[usd] = r.GetSize() if not r.IsEmpty() else Gf.Vec3d(1, 1, 1)
        except Exception:
            _size_cache[usd] = Gf.Vec3d(1, 1, 1)
    return _size_cache[usd]


def disable_physics(prim):
    """Props move kinematically with the line, so their rigid bodies must not simulate.
    Prefer a physics variant (keeps the prim instanceable); otherwise switch rigid bodies off."""
    vsets = prim.GetVariantSets()
    for name in vsets.GetNames():
        if "phys" in name.lower():
            vs = vsets.GetVariantSet(name)
            for v in vs.GetVariantNames():
                if v.lower() in ("none", "disabled", "off", "visual", "nophysics", "no_physics"):
                    vs.SetVariantSelection(v)
                    break
    for p in Usd.PrimRange(prim):          # and switch off anything the variant left on
        if p.HasAPI(UsdPhysics.RigidBodyAPI):
            UsdPhysics.RigidBodyAPI(p).CreateRigidBodyEnabledAttr(False)


def prop(path, usd, pos, **kw):
    prim = reference(path, usd, pos, **kw)
    disable_physics(prim)
    return prim


# ------------------------------------------------------------------ build: building shell & lights
assets = AssetResolver(args.endpoint, args.offline, args.assets)
dome = UsdLux.DomeLight.Define(stage, f"{ROOT}/Dome")
dome.CreateIntensityAttr(900)
sun = UsdLux.DistantLight.Define(stage, f"{ROOT}/Sun")
sun.CreateIntensityAttr(2500)
UsdGeom.XformCommonAPI(sun).SetRotate(Gf.Vec3f(-50, 20, 0))
cube(f"{ROOT}/Floor", (140, 48, 0.1), (0, 0, -0.05), MAT["floor"])
cube(f"{ROOT}/WallBack", (140, 0.3, 14), (0, 24, 7), MAT["white"])
cube(f"{ROOT}/WallLeft", (0.3, 48, 14), (-70, 0, 7), MAT["white"])
for i, x in enumerate(range(-66, 67, 12)):
    cube(f"{ROOT}/Columns/c{i}", (0.5, 0.5, 14), (x, 23.4, 7), MAT["frame"])

# ------------------------------------------------------------------ V8 engine (procedural, 8 assembly stages)
ES = 0.8
ENGINE_PARTS = ["Block", "Crank", "PistonsL", "PistonsR", "HeadL", "HeadR", "Intake", "Covers"]


def build_engine(path):
    """Engine Xform with one child per assembly stage (matches data/plant.json ST10-ST80).
    SimReady engine components replace the proxy shapes where available; the block stays procedural
    (SimReady has no V8 block)."""
    root = Mover(path)
    s = ES
    parts = []
    for name in ENGINE_PARTS:
        UsdGeom.Xform.Define(stage, f"{path}/{name}")
        parts.append(stage.GetPrimAtPath(f"{path}/{name}"))
    sr = (lambda key: assets.simready(key)) if args.engine_detail == "simready" else (lambda key: None)
    du = lambda side, h: (0.66 + h * 0.707) * s  # noqa: E731  deck height in a bank
    dz = lambda side, h: (0.2 + h * 0.707) * s * side  # noqa: E731
    # ST10 block (procedural)
    bx(f"{path}/Block/case", 1.2 * s, 0.42 * s, 0.62 * s, 0, 0.35 * s, 0, MAT["alu"])
    for side in (-1, 1):
        bx(f"{path}/Block/bank{side + 1}", 1.15 * s, 0.46 * s, 0.3 * s, 0, 0.66 * s, 0.2 * s * side, MAT["alu"], rot_x=45 * side)
    # ST20 crank + flywheel
    if sr("crankshaft"):
        prop(f"{path}/Crank/crankshaft", sr("crankshaft"), P(0, 0.3 * s, 0), fit=1.05, force_fit=True, long_axis="x", snap="center")
    else:
        cyl(f"{path}/Crank/shaft", 0.05 * s, 1.36 * s, (0, 0, 0.3 * s), MAT["steel"], "X")
    if sr("flywheel"):
        prop(f"{path}/Crank/flywheel", sr("flywheel"), P(-0.66 * s, 0.3 * s, 0), fit=0.48, force_fit=True, fit_axis="max",
             tilt_y=90.0, snap="center")   # SimReady flywheel lies flat: stand it up facing the crank axis
    else:
        cyl(f"{path}/Crank/flywheel", 0.3 * s, 0.05 * s, (-0.66 * s, 0, 0.3 * s), MAT["dark"], "X")
    cyl(f"{path}/Crank/pulley", 0.15 * s, 0.08 * s, (0.7 * s, 0, 0.3 * s), MAT["black"], "X")
    # ST30 / ST40 pistons
    for k, side in ((2, -1), (3, 1)):
        for i in range(4):
            x = (-0.42 + i * 0.28) * s
            if sr("piston"):
                prop(f"{path}/{ENGINE_PARTS[k]}/p{i}", sr("piston"), P(x, du(side, 0.27), dz(side, 0.27)), fit=0.3, force_fit=True,
                     fit_axis="z", tilt_x=45 * side, snap="top")   # piston + rod: crown at the deck, rod inside the block
            else:
                cyl(f"{path}/{ENGINE_PARTS[k]}/p{i}", 0.088 * s, 0.05 * s, P(x, du(side, 0.25), dz(side, 0.25)), MAT["steel"])
    # ST50 / ST60 heads + exhaust manifolds
    for k, side in ((4, -1), (5, 1)):
        if sr("cylinder_head"):
            prop(f"{path}/{ENGINE_PARTS[k]}/head", sr("cylinder_head"), P(0, du(side, 0.32), dz(side, 0.32)), fit=0.92, force_fit=True,
                 long_axis="x", tilt_x=45 * side, snap="center")
        else:
            bx(f"{path}/{ENGINE_PARTS[k]}/head", 1.15 * s, 0.16 * s, 0.34 * s, 0, du(side, 0.32), dz(side, 0.32), MAT["dark"], rot_x=45 * side)
        if sr("exhaust_manifold"):
            prop(f"{path}/{ENGINE_PARTS[k]}/exhaust", sr("exhaust_manifold"), P(0, 0.62 * s, 0.55 * s * side), fit=0.8, force_fit=True,
                 long_axis="x", snap="center")
        else:
            bx(f"{path}/{ENGINE_PARTS[k]}/exhaust", 1.0 * s, 0.11 * s, 0.11 * s, 0, 0.62 * s, 0.52 * s * side, MAT["rust"])
    # ST70 intake
    if sr("intake_manifold"):
        prop(f"{path}/Intake/manifold", sr("intake_manifold"), P(0, 1.02 * s, 0), fit=0.75, force_fit=True, long_axis="x", snap="center")
    else:
        bx(f"{path}/Intake/plenum", 0.9 * s, 0.14 * s, 0.26 * s, 0, 1.0 * s, 0, MAT["steel"])
        bx(f"{path}/Intake/cap", 0.82 * s, 0.04 * s, 0.2 * s, 0, 1.09 * s, 0, MAT["red"])
    # ST80 valve covers, timing, oil pan, water pump
    for side in (-1, 1):
        bx(f"{path}/Covers/vc{side + 1}", 1.08 * s, 0.1 * s, 0.28 * s, 0, du(side, 0.45), dz(side, 0.45), MAT["red"], rot_x=45 * side)
    if sr("timing_chain"):
        prop(f"{path}/Covers/timing_chain", sr("timing_chain"), P(0.6 * s, 0.55 * s, 0), fit=0.45, force_fit=True, fit_axis="max",
             tilt_y=90.0, snap="center")
    bx(f"{path}/Covers/timing", 0.06 * s, 0.62 * s, 0.7 * s, 0.64 * s, 0.55 * s, 0, MAT["black"])
    if sr("oil_pan"):
        prop(f"{path}/Covers/oil_pan", sr("oil_pan"), P(0, 0.07 * s, 0), fit=0.9, force_fit=True, long_axis="x", snap="center")
    else:
        bx(f"{path}/Covers/pan", 1.1 * s, 0.16 * s, 0.5 * s, 0, 0.06 * s, 0, MAT["dark"])
    if sr("water_pump"):
        prop(f"{path}/Covers/water_pump", sr("water_pump"), P(0.7 * s, 0.9 * s, 0.22 * s), fit=0.22, force_fit=True, snap="center")
    return root, parts


def set_parts(parts, vis, cache):
    for i, p in enumerate(parts):
        if cache[i] != vis[i]:
            img = UsdGeom.Imageable(p)
            img.MakeVisible() if vis[i] else img.MakeInvisible()
            cache[i] = vis[i]


# ------------------------------------------------------------------ V8 line: conveyor + pallets
_conv = [u for u in (assets.simready(k) for k in ("conveyor", "conveyor_a05", "conveyor_a08", "conveyor_a35", "conveyor_a47", "conveyor_a61")) if u]
conv_usd = max(_conv, key=lambda u: max(bbox_size_of(u)[0], bbox_size_of(u)[1]) / max(min(bbox_size_of(u)[0], bbox_size_of(u)[1]), 1e-3)) if _conv else None
if conv_usd:
    print(f"[V8Plant] conveyor section: {conv_usd} size {tuple(round(v, 2) for v in bbox_size_of(conv_usd))}")
if conv_usd:
    # tile SimReady conveyor sections along both straights
    proto = reference(f"{ROOT}/V8Line/_probe", conv_usd, (0, 0, -50), fit=3.0)
    sz = bbox_size(proto)
    stage.RemovePrim(proto.GetPath())
    along_x = sz[0] >= sz[1]
    seg = max(sz[0] if along_x else sz[1], 0.5)
    n = max(1, int(V8["S"] // seg))
    for lane, z in (("top", V8["zt"]), ("bot", V8["zb"])):
        for i in range(n):
            prop(f"{ROOT}/V8Line/{lane}_{i}", conv_usd, P(V8["x0"] + (i + 0.5) * seg, 0, z),
                      yaw=0.0 if along_x else math.pi / 2, fit=3.0)
else:
    for lane, z in (("top", V8["zt"]), ("bot", V8["zb"])):
        bx(f"{ROOT}/V8Line/{lane}", V8["S"], BELT_Y, 1.6, V8["x0"] + V8["S"] / 2, BELT_Y / 2, z, MAT["frame"])
for end, cx in (("east", V8["x0"] + V8["S"]), ("west", V8["x0"])):
    cyl(f"{ROOT}/V8Line/turn_{end}", V8["R"] + 0.8, BELT_Y, P(cx, BELT_Y / 2, V8["cz"]), MAT["frame"])

pal_usd = assets.simready("pallet")
pallets = []
for p in range(NP):
    pm = Mover(f"{ROOT}/V8Line/Pallet_{p:02d}")
    if pal_usd:
        prop(f"{pm.path}/Body", pal_usd, (0, 0, 0), fit=1.9, force_fit=True)
    else:
        cube(f"{pm.path}/Body", (1.9, 1.5, 0.1), (0, 0, 0.06), MAT["dark"])
    eng, parts = build_engine(f"{pm.path}/Engine")
    eng.set((0, 0, 0.12))
    pallets.append(dict(m=pm, parts=parts, cache=[True] * 8))


def stage_vis(q, moving, dw):
    vis = [False] * 8
    if moving:
        if 1 <= q <= 9:
            for i in range(min(q, 8)):
                vis[i] = True
        return vis
    if q <= 7:
        for i in range(q):
            vis[i] = True
        if dw >= R:
            vis[q] = True
    elif q == 8 or (q == 9 and dw < G):
        vis = [True] * 8
    return vis


# ------------------------------------------------------------------ robots
# SimReady arms (Comau N-220-27 for heavy work, FANUC CRX-10iA cobots on the V8 line) are driven with
# usd_arm.UsdArm: IK is read from the robot's own USD joints, solved once per robot at start-up over one
# cycle, then replayed by writing the joints' drive targets. UR10 + Lula / analytic remains as a fallback.
UR10_LINKS = dict(a2=0.612, a3=0.5723, d1=0.1273, tool=0.25)
ROBOT_SPECS = {
    "cobot": dict(asset="robot_cobot", tool=0.24, pedestal=0.75, color="orange"),
    "heavy": dict(asset="robot_heavy", tool=0.45, pedestal=0.0, color="red"),
}
TRAJ_SAMPLES = 96
ROBOT_CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(args.assets)), "robot_cache.json")
try:
    with open(ROBOT_CACHE_PATH, encoding="utf-8") as _f:
        ROBOT_CACHE = json.load(_f)
except Exception:
    ROBOT_CACHE = {}
VIA = 48            # IK via-points per dwell


class LineRobot:
    """A station robot doing timed pick -> place operations every dwell (ops are split evenly over the dwell)."""

    def __init__(self, name, base, ops, kind="cobot", carry_asset=None, carry_fit=0.4, lift=0.35):
        self.name, self.kind = name, kind
        self.base = np.array(base, float)
        self.ops = [(np.array(a, float), np.array(b, float)) for a, b in ops]
        self.lift = np.array([0, 0, lift])
        self.path = f"{ROOT}/Robots/{name}"
        spec = ROBOT_SPECS[kind]
        ped = spec["pedestal"]
        a0, b0 = self.ops[0]
        self.home = (a0 + b0) / 2 + np.array([0, 0, 0.6])
        self.mode, self.arm, self.art, self.ik = "none", None, None, None
        usd = assets.simready(spec["asset"]) if args.robots == "simready" else None
        self.cache_key = None
        if usd:
            reference(self.path, usd, (base[0], base[1], 0.0), snap="base", units=True)
            enable_robot_variants(stage.GetPrimAtPath(self.path))
            try:
                self.arm = UsdArm(stage, self.path, tool_length=spec["tool"])
                self.mode = "usd"
                import hashlib
                sig = json.dumps([usd, os.path.getsize(usd) if os.path.exists(usd) else 0, spec["tool"], self.lift.tolist(),
                                  [[a.tolist(), b.tolist()] for a, b in self.ops], TRAJ_SAMPLES, VIA], sort_keys=True)
                self.cache_key = f"{name}:{hashlib.sha1(sig.encode()).hexdigest()[:16]}"
                hit = ROBOT_CACHE.get(self.cache_key)
                if hit:
                    ped = self._apply_placement(np.array(hit["xy"]), hit["ped"], spec["tool"])
                else:
                    ped = self._fit_placement(spec["tool"])
            except Exception as e:
                print(f"[{name}] SimReady robot could not be set up ({e}); falling back")
                stage.RemovePrim(self.path)
                self.mode, self.arm, ped = "none", None, spec["pedestal"]
        if ped > 0.02:
            cube(f"{ROOT}/Robots/{name}_pedestal", (0.7, 0.7, ped), (self.base[0], self.base[1], ped / 2), MAT["grey"])
        if self.mode == "none":
            ur, kind_ = assets.robot() if assets.nucleus else (None, "none")
            if ur and kind_ == "ur10":
                reference(self.path, ur, (base[0], base[1], ped), snap=None)
                self.mode = "ur10"
            else:
                cube(self.path, (0.5, 0.5, 1.6), (base[0], base[1], ped + 0.8), MAT[spec["color"]])
        self.carry, self.carry_h = None, 0.0
        if carry_asset:
            self.carry = Mover(f"{ROOT}/Robots/{name}_carry")
            prim = prop(f"{self.carry.path}/part", carry_asset, (0, 0, 0), fit=carry_fit, force_fit=True)
            self.carry_h = float(bbox_size(prim)[2])
            self.carry.show(False)
        self.Q = None

    def _fit_placement(self, tool):
        """Place this robot for its real size. Candidate (distance from the work, pedestal height) pairs are
        scored by actually solving IK for every pick / place point with the arm read from its USD, so the
        layout adapts to whichever SimReady arm is loaded."""
        import copy
        a0 = self.arm
        pts = [p for ab in self.ops for p in ab] + [p + self.lift for ab in self.ops for p in ab]
        P_ = np.array(pts)
        W = P_ + np.array([0, 0, tool])
        h_sh = float(a0.points[1][2] - a0.points[0][2]) if a0.n > 1 else 0.3
        reach = float(np.sum(np.linalg.norm(np.diff(np.vstack([a0.points[1:], a0.tool0]), axis=0), axis=1)) - tool)
        centre = W[:, :2].mean(axis=0)
        d0 = self.base[:2] - centre
        direction = d0 / (np.linalg.norm(d0) + 1e-9)
        lo_z, hi_z = W[:, 2].min(), W[:, 2].max()

        def trial(dist, ped):
            """worst miss over the taught points + penalty for any joint jump along the whole cycle"""
            arm = copy.copy(a0)
            delta = np.array([*(centre + direction * dist - self.base[:2]), ped])
            arm.points, arm.tool0 = a0.points + delta, a0.tool0 + delta
            arm.q = arm.solve_best(P_.mean(axis=0) + np.array([0, 0, 0.3]), seeds=6, iters=80)
            err, jump, prev = 0.0, 0.0, arm.q.copy()
            for u in np.linspace(0, 1, 25):
                p = self.target(u)
                q = arm.solve(p, iters=60, restarts=0)
                e = float(np.linalg.norm(arm.fk(q)[0] - p))
                if e > 3e-3:
                    q = arm.solve_best(p, prev=prev, seeds=6, iters=80)
                    e = float(np.linalg.norm(arm.fk(q)[0] - p))
                err, jump, prev = max(err, e), max(jump, float(np.abs(q - prev).max())), q.copy()
            return 10.0 * err + 0.005 * max(0.0, math.degrees(jump) - 30.0)

        peds = sorted({float(np.clip(z - h_sh, 0.0, 1.6)) for z in (lo_z - 0.3, lo_z, lo_z + 0.3 * (hi_z - lo_z), (lo_z + hi_z) / 2)})
        dists = [f * reach for f in (0.3, 0.4, 0.5, 0.6, 0.7)]
        best = (1e9, dists[1], peds[0])
        for ped in peds:
            for dist in dists:
                e = trial(dist, ped)
                if e < best[0] - 1e-4:
                    best = (e, dist, ped)
            if best[0] < 0.03:
                break
        _, dist, ped = best
        return self._apply_placement(centre + direction * dist, ped, tool)

    def _apply_placement(self, xy, ped, tool):
        prim = stage.GetPrimAtPath(self.path)
        t = [op for op in UsdGeom.Xformable(prim).GetOrderedXformOps() if op.GetOpType() == UsdGeom.XformOp.TypeTranslate][0]
        v = t.Get()
        _v3(t, (v[0] + xy[0] - self.base[0], v[1] + xy[1] - self.base[1], v[2] + ped))
        self.base = np.array([xy[0], xy[1], ped])
        self.arm = UsdArm(stage, self.path, tool_length=tool)                      # re-read at the final pose
        return ped

    def target(self, dw):
        """tool-tip target for this dwell fraction (dw<0 = home)."""
        if dw < 0:
            return self.home
        n = len(self.ops)
        k = min(int(dw * n), n - 1)
        u = dw * n - k
        pick, place = self.ops[k]
        keys = [(0, self.home), (.14, pick + self.lift), (.22, pick), (.30, pick), (.38, pick + self.lift),
                (.58, place + self.lift), (.64, place), (.72, place), (.80, place + self.lift), (1, self.home)]
        for (ta, a), (tb, b) in zip(keys, keys[1:]):
            if u < tb:
                return a + (b - a) * smooth((u - ta) / (tb - ta))
        return self.home

    def holding(self, moving, dw):
        if moving or dw < 0:
            return False
        n = len(self.ops)
        f = dw * n - min(int(dw * n), n - 1)
        return G <= f < R

    def _taught_points(self):
        """(time in dwell, point) for every taught point of every op — same timing as target()."""
        n, out = len(self.ops), []
        for k, (pick, place) in enumerate(self.ops):
            for tf, p in ((0, self.home), (.14, pick + self.lift), (.22, pick), (.30, pick), (.38, pick + self.lift),
                          (.58, place + self.lift), (.64, place), (.72, place), (.80, place + self.lift), (1, self.home)):
                t = (k + tf) / n
                if not out or t > out[-1][0] + 1e-9:
                    out.append((t, p))
        return out

    def precompute(self):
        """Point-to-point motion like a taught industrial robot: IK only at the taught points (one consistent
        arm configuration, each solved from the previous one), smooth joint interpolation in between.
        Replayed every cycle (the line is periodic)."""
        if self.mode != "usd":
            return
        a = self.arm
        hit = ROBOT_CACHE.get(self.cache_key)
        if hit and "Q" in hit:
            self.Q_home, self.Q = np.array(hit["Q_home"]), np.array(hit["Q"])
            self.key_err, self.reach_err, self.max_step = hit["key_err"], hit["reach_err"], hit["max_step"]
            a.command(self.Q_home)
            return
        a.q = np.zeros(a.n)
        pts = self._taught_points()
        centroid = np.mean([p for _, p in pts], axis=0) + np.array([0, 0, 0.3])
        q_c = a.solve_best(centroid).copy()          # one natural "working posture" over the work area
        self.Q_home = a.solve_best(self.home, prev=q_c).copy()
        # dense via-points along the Cartesian path, each solved from the previous one (continuity);
        # a multi-seed search only when the warm start misses or would jump
        times = sorted({round(k / VIA, 6) for k in range(VIA + 1)} | {round(t, 6) for t, _ in pts})
        taught, key, prev = [], 0.0, self.Q_home
        taught_t = {round(t, 6) for t, _ in pts}
        for t in times:
            p = self.target(t) if t < 1 else self.home
            a.q = prev.copy()
            q = a.solve(p, iters=120, restarts=0).copy()
            if np.linalg.norm(a.fk(q)[0] - p) > 2e-3 or np.abs(q - prev).max() > math.radians(35):
                q = a.solve_best(p, prev=prev).copy()
            e = float(np.linalg.norm(a.fk(q)[0] - p))
            if t in taught_t:
                key = max(key, e)
            taught.append((t, q))
            prev = q
        Q = []
        for k in range(TRAJ_SAMPLES + 1):
            u = k / TRAJ_SAMPLES
            for (ta, qa), (tb, qb) in zip(taught, taught[1:]):
                if u <= tb + 1e-9:
                    Q.append(qa + (qb - qa) * smooth((u - ta) / max(tb - ta, 1e-9)))
                    break
        self.Q = np.array(Q)
        self.key_err = key
        self.reach_err = max(float(np.linalg.norm(a.fk(q)[0] - self.target(k / TRAJ_SAMPLES))) for k, q in enumerate(self.Q))
        self.max_step = float(np.degrees(np.abs(np.diff(self.Q, axis=0)).max()))
        ROBOT_CACHE[self.cache_key] = dict(xy=self.base[:2].tolist(), ped=float(self.base[2]), Q_home=self.Q_home.tolist(),
                                           Q=self.Q.tolist(), key_err=self.key_err, reach_err=self.reach_err, max_step=self.max_step)
        a.command(self.Q_home)

    def initialize(self):
        if self.mode != "ur10":
            return
        self.art = SingleArticulation(prim_path=self.path, name=self.name)
        self.art.initialize()
        try:
            from isaacsim.robot_motion.motion_generation import (ArticulationKinematicsSolver,
                                                                 LulaKinematicsSolver, interface_config_loader)
            cfg = interface_config_loader.load_supported_lula_kinematics_solver_config("UR10")
            lula = LulaKinematicsSolver(**cfg)
            lula.set_robot_base_pose(self.base, np.array([1.0, 0, 0, 0]))
            self.ik = ArticulationKinematicsSolver(self.art, lula, "ee_link")
        except Exception as e:
            print(f"[{self.name}] Lula IK unavailable ({e}); using analytic choreography")

    def analytic(self, tgt):
        d = tgt - self.base
        yaw = math.atan2(d[1], d[0])
        L1, L2 = UR10_LINKS["a2"], UR10_LINKS["a3"]
        r = math.hypot(d[0], d[1])
        h = d[2] + UR10_LINKS["tool"] - UR10_LINKS["d1"]
        dist = min(math.hypot(r, h), L1 + L2 - 1e-3)
        e = math.acos(max(-1, min(1, (dist * dist - L1 * L1 - L2 * L2) / (2 * L1 * L2))))
        s = math.atan2(h, r) + math.atan2(L2 * math.sin(e), L1 + L2 * math.cos(e))
        q = np.zeros(int(self.art.num_dof))
        vals = [yaw, -s, e, -math.pi / 2 + s - e, -math.pi / 2, 0.0]
        q[:min(6, len(q))] = vals[:min(6, len(q))]
        return q

    def step(self, moving, dw):
        if self.mode == "usd" and self.Q is not None:
            if moving or dw < 0:
                q = self.Q_home
            else:
                f = dw * TRAJ_SAMPLES
                i = min(int(f), TRAJ_SAMPLES - 1)
                q = self.Q[i] + (self.Q[i + 1] - self.Q[i]) * (f - i)
            self.arm.command(q)
        elif self.mode == "ur10" and self.art is not None:
            tgt = self.target(-1 if moving else dw)
            if self.ik is not None:
                action, ok = self.ik.compute_inverse_kinematics(tgt, np.array([0, 1.0, 0, 0]))
                if ok:
                    self.art.apply_action(action)
            else:
                self.art.apply_action(ArticulationAction(joint_positions=self.analytic(tgt)))
        if self.carry is not None:
            hold = self.holding(moving, dw)
            self.carry.show(hold)
            if hold:
                p = self.arm.fk(q)[0] if self.mode == "usd" and self.Q is not None else self.target(dw)
                self.carry.set((p[0], p[1], p[2] - self.carry_h))


def lane_y(zw): return -zw   # web z -> Isaac y


robots = []
# V8 line: FANUC CRX-10iA cobots on the inner side of the loop (reach ~1.25 m), parts table beside each
V8_CARRY = [None, "crankshaft", "piston", "piston", "cylinder_head", "cylinder_head", "intake_manifold", "oil_pan"]
V8_PLACE_Z = [1.66, 1.25, 1.62, 1.62, 1.75, 1.75, 1.75, 1.8]
for i in range(8):
    x, ly = slot_x(i), lane_y(V8["zt"])
    place = (x, ly + 0.2, V8_PLACE_Z[i])
    pick = (x - 0.75, ly + 1.1, 1.0)
    cube(f"{ROOT}/V8Line/Table_{i}", (0.7, 0.6, 0.85), (pick[0], pick[1], 0.425), MAT["grey"])
    key = V8_CARRY[i]
    part_usd = assets.simready(key) if key and args.engine_detail == "simready" else None
    if part_usd:
        prop(f"{ROOT}/V8Line/Stock_{i}", part_usd, (pick[0], pick[1], 0.85), fit=0.45)
    crate = assets.simready("small_load_carrier") or assets.simready("crate")
    if crate:
        prop(f"{ROOT}/V8Line/Bin_{i}", crate, (pick[0] - 0.8, pick[1], 0), fit=0.6)
    robots.append(LineRobot(V8ST[i]["id"], (x, ly + 0.95, 0), [(pick, place)], "cobot", part_usd, 0.45))
# ST100 unload: Comau N-220-27 moves the finished engine to the hot-test bench
robots.append(LineRobot("ST100", (XU - 1.6, lane_y(-3.2), 0), [((XU, lane_y(V8["zt"]), 1.7), (XU, lane_y(-1.4), 1.9))], "heavy"))
# body shop: 8 welding robots
for s_ in range(4):
    for side in (-1, 1):
        bxw, cy = car_x(s_), lane_y(CL["z"])
        a = (bxw - 0.9, cy - side * 0.98, Y_SKID + 0.9)
        b = (bxw + 0.9, cy - side * 0.98, Y_SKID + 1.25)
        robots.append(LineRobot(f"B{(s_ + 1) * 10}_{'L' if side < 0 else 'R'}", (bxw, cy - side * 2.3, 0), [(a, b)], "heavy", lift=0.2))
# B50 closures: doors (front then rear) on each side
for side in (-1, 1):
    x, cy = car_x(4), lane_y(CL["z"])
    rack = (x - 2.4, cy - side * 2.0, 1.5)
    door = lambda dx: (x + dx, cy - side * 0.9, Y_SKID + 1.08)  # noqa: E731
    robots.append(LineRobot(f"B50_{'L' if side < 0 else 'R'}", (x, cy - side * 2.6, 0), [(rack, door(0.35)), (rack, door(-0.66))],
                            "heavy", assets.simready("door_front"), 1.0))
# T30 wheels and T40 glass
for side in (-1, 1):
    x, cy = car_x(10), lane_y(CL["z"])
    rack = (x, cy - side * 3.0, 1.3)
    wheel = lambda dx: (x + dx, cy - side * 0.98, Y_HANG + 0.7)  # noqa: E731
    robots.append(LineRobot(f"T30_{'L' if side < 0 else 'R'}", (x, cy - side * 2.6, 0), [(rack, wheel(1.4)), (rack, wheel(-1.4))],
                            "heavy", assets.simready("tire"), 0.68))
robots.append(LineRobot("T40", (car_x(11), lane_y(CL["z"]) - 2.7, 0),
                        [((car_x(11) + 1.9, lane_y(CL["z"]) - 3.9, 1.35), (car_x(11) + 0.63, lane_y(CL["z"]), Y_HANG + 1.34))], "heavy"))

# ------------------------------------------------------------------ hot test, transfer belt, car line
cube(f"{ROOT}/HotTest/Stand", (1.6, 1.3, 0.75), (XU, lane_y(-1.4), 0.4), MAT["dark"])
cyl(f"{ROOT}/HotTest/Dyno", 0.38, 0.5, (XU - 1.15, lane_y(-1.4), 1.2), MAT["frame"], "X")
hot_eng, hot_parts = build_engine(f"{ROOT}/HotTest/Engine")
hot_eng.set(P(XU, 0.95, -1.4))
BELT_PTS = [(XU, 0.95, -1.4), (XU, 0.6, 0.6), (XU, 0.6, 3.2), (car_x(9) + 1.55, 0.6, 3.2), (car_x(9) + 1.55, 0.6, CL["z"])]
seg_len = [math.dist(a, b) for a, b in zip(BELT_PTS, BELT_PTS[1:])]
BELT_LEN, BELT_M = sum(seg_len), 3
for i, (a, b) in enumerate(zip(BELT_PTS[1:], BELT_PTS[2:])):
    mid = [(a[k] + b[k]) / 2 for k in range(3)]
    L = math.dist(a, b)
    along_x = abs(a[0] - b[0]) > 0.1
    bx(f"{ROOT}/TransferBelt/s{i}", L if along_x else 1.2, 0.5, 1.2 if along_x else L, mid[0], 0.3, mid[2], MAT["frame"])
belt_engines = []
for i in range(5):
    m, parts = build_engine(f"{ROOT}/TransferBelt/Engine_{i}")
    belt_engines.append(m)


def belt_point(d):
    for (a, b), L in zip(zip(BELT_PTS, BELT_PTS[1:]), seg_len):
        if d <= L:
            f = d / L
            return [a[k] + (b[k] - a[k]) * f for k in range(3)]
        d -= L
    return list(BELT_PTS[-1])


# car body line: skid bed, paint booth, overhead rail
bx(f"{ROOT}/CarLine/SkidBed", car_x(8) - car_x(-1) + 6, 0.48, 1.5, (car_x(-1) + car_x(8)) / 2, 0.24, CL["z"], MAT["grey"])
bx(f"{ROOT}/CarLine/Rail", car_x(13) - car_x(7) + 3, 0.36, 0.3, (car_x(7) + car_x(13)) / 2 + 1.5, RAIL_Y + 0.22, CL["z"], MAT["frame"])
bx(f"{ROOT}/CarLine/PaintBooth", car_x(7) - car_x(5) + 6.2, 4.6, 6.6, car_x(6), 2.3, CL["z"], MAT["glass"])


def build_car(path):
    """Car = Shell (BIW, B10-B40) + Closures (B50) + paint (P20) + Engine (T20) + Wheels (T30) + Finish (T40)."""
    m = Mover(path)
    sub = {}
    for k in ("Shell", "Closures", "Finish", "Wheels", "Engine"):
        UsdGeom.Xform.Define(stage, f"{path}/{k}")
        sub[k] = stage.GetPrimAtPath(f"{path}/{k}")
    paint = UsdShade.Material.Define(stage, f"{path}/Paint")
    sh = UsdShade.Shader.Define(stage, f"{path}/Paint/S")
    sh.CreateIdAttr("UsdPreviewSurface")
    col = sh.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f)
    col.Set(Gf.Vec3f(*BIW))
    sh.CreateInput("metallic", Sdf.ValueTypeNames.Float).Set(0.5)
    sh.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(0.35)
    sh.CreateInput("clearcoat", Sdf.ValueTypeNames.Float).Set(1.0)
    paint.CreateSurfaceOutput().ConnectToSource(sh.ConnectableAPI(), "surface")
    pm = (paint, sh)
    frame = assets.simready("car_frame")
    if frame:  # SimReady body-in-white
        prop(f"{path}/Shell/frame", frame, (0, 0, 0.25), fit=4.4, force_fit=True, long_axis="x")
    else:
        bx(f"{path}/Shell/floor", 3.1, 0.3, 1.8, -0.65, 0.4, 0, pm)
        bx(f"{path}/Shell/rear", 1.1, 0.5, 1.8, -1.7, 0.8, 0, pm)
        bx(f"{path}/Shell/roof", 1.7, 0.07, 1.62, -0.42, 1.52, 0, pm)
        bx(f"{path}/Shell/firewall", 0.1, 0.5, 1.6, 0.92, 0.8, 0, pm)
        for side in (-1, 1):
            bx(f"{path}/Shell/bpillar{'L' if side < 0 else 'R'}", 0.1, 0.46, 0.08, -0.3, 1.28, 0.8 * side, pm)
    # closures: doors / fenders (SimReady parts are one-handed, so the other side is mirrored)
    for side in (-1, 1):
        n = "L" if side < 0 else "R"
        for key, dx, w in (("door_front", 0.35, 1.0), ("door_rear", -0.66, 0.98), ("fender_front", 1.58, 1.3)):
            usd = assets.simready(key)
            if usd:
                prim = prop(f"{path}/Closures/{key}_{n}", usd, P(dx, 0.32, 0.88 * side), fit=w, force_fit=True, long_axis="x")
                if side > 0:
                    sc = [op for op in UsdGeom.Xformable(prim).GetOrderedXformOps() if op.GetOpType() == UsdGeom.XformOp.TypeScale][0]
                    v = sc.Get()
                    _v3(sc, (v[0], -v[1], v[2]))
            else:
                bx(f"{path}/Closures/{key}_{n}", w, 0.44, 0.08, dx, 0.84, 0.87 * side, pm)
    hood = assets.simready("hood")
    if hood:
        prop(f"{path}/Finish/hood", hood, P(1.58, 1.0, 0), fit=1.6, force_fit=True)
    else:
        bx(f"{path}/Finish/hood", 1.3, 0.05, 1.62, 1.58, 1.08, 0, pm)
    for key, dx in (("bumper_front", 2.28), ("bumper_rear", -2.3)):
        usd = assets.simready(key)
        if usd:
            prop(f"{path}/Finish/{key}", usd, P(dx, 0.3, 0), fit=1.85, force_fit=True)
    bx(f"{path}/Finish/windshield", 0.03, 0.66, 1.52, 0.63, 1.28, 0, MAT["glass"])
    _wheels_and_engine(path)
    return dict(m=m, sub=sub, col=col, vis={k: True for k in sub})


def _wheels_and_engine(path):
    tire, rim = assets.simready("tire"), assets.simready("wheel_rim")
    for i, (wx, wz) in enumerate(((1.4, -0.86), (-1.4, -0.86), (1.4, 0.86), (-1.4, 0.86))):
        if tire:
            prop(f"{path}/Wheels/w{i}", tire, P(wx, 0.0, wz), fit=0.68, force_fit=True)
            if rim:
                prop(f"{path}/Wheels/r{i}", rim, P(wx, 0.34, wz), fit=0.45, force_fit=True, fit_axis="max", long_axis=None,
                     yaw=math.pi / 2 if bbox_size_of(rim)[0] < bbox_size_of(rim)[1] else 0.0, snap="center")
        else:
            cyl(f"{path}/Wheels/w{i}", 0.34, 0.24, P(wx, 0.34, wz), MAT["black"], "Y")
    bx(f"{path}/Engine/block", 0.9, 0.7, 0.7, 1.55, 0.45, 0, MAT["alu"])
    bx(f"{path}/Engine/covers", 0.86, 0.1, 0.8, 1.55, 0.85, 0, MAT["red"])
    trn = assets.simready("transmission")
    if trn:
        prop(f"{path}/Engine/transmission", trn, P(0.6, 0.35, 0), fit=0.8, force_fit=True, long_axis="x", snap="center")


CAR_POOL = 30
cars = [build_car(f"{ROOT}/CarLine/Car_{i:02d}") for i in range(CAR_POOL)]

# finished-vehicle yard + logistics decor from SimReady
LOT = [(37 + (i % 6) * 3.5, 15.2 if i >= 6 else 0.8) for i in range(12)]
veh = assets.simready("vehicle")
if veh:  # a few SimReady cars parked as display in front of the yard
    for i in range(3):
        prop(f"{ROOT}/Yard/Display_{i}", veh, P(40 + i * 5, 0, 21), yaw=math.pi / 2, fit=4.6)
DECOR = [("rack", -40, -21, 0, 3.0), ("rack", -30, -21, 0, 3.0), ("tire_rack", car_x(10) + 1, 14.5, 0, 2.0), ("small_load_carrier", -12, -8.5, 0, 0.6), ("lift_table", 10, -8.6, 0, 1.6),
         ("air_compressor", XU + 3.5, -2.5, 0, 1.5), ("parts_cart", car_x(10) + 3, 13.5, 0, 1.2), ("parts_cart", car_x(11) + 3, 13.5, 0, 1.2),
         ("safety_gate", V8["x0"] - 6, -15, math.pi / 2, 2.0)]
DECOR += [("fence", x, V8["zb"] - 3.0, 0, 2.4) for x in range(int(V8["x0"]) - 4, int(V8["x0"] + V8["S"]) + 6, 3)]
for i, (key, x, zw, yaw, fit) in enumerate(DECOR):
    usd = assets.simready(key)
    if usd:
        prop(f"{ROOT}/Decor/{key}_{i}", usd, P(x, 0, zw), yaw=yaw, fit=fit)

amr_usd = assets.simready("amr")
AMR_ROUTES = [[(-30, -15.6), (32, -15.6), (32, -17.6), (-30, -17.6)], [(-60, 2.4), (-6, 2.4), (-6, 0.6), (-60, 0.6)]]
amrs = []
for ri, route in enumerate(AMR_ROUTES):
    for k in range(2):
        m = Mover(f"{ROOT}/AMR/amr_{ri}_{k}")
        if amr_usd:
            prop(f"{m.path}/Body", amr_usd, (0, 0, 0), fit=1.4)
        else:
            cube(f"{m.path}/Body", (1.4, 0.9, 0.35), (0, 0, 0.22), MAT["white"])
            box_usd = assets.simready("box")
            if box_usd:
                prop(f"{m.path}/Load", box_usd, (0, 0, 0.4), fit=0.8)
            else:
                cube(f"{m.path}/Load", (1.1, 0.75, 0.35), (0, 0, 0.57), MAT["yellow"])
        amrs.append(dict(m=m, route=route, off=k / 2))


def route_point(route, u):
    segs = list(zip(route, route[1:] + route[:1]))
    lens = [math.dist(a, b) for a, b in segs]
    d = u * sum(lens)
    for (a, b), L in zip(segs, lens):
        if d <= L:
            f = d / L
            return a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, math.atan2(-(b[1] - a[1]), b[0] - a[0])
        d -= L
    return route[0][0], route[0][1], 0.0


# ------------------------------------------------------------------ per-frame update (same state machine as index.html)
def car_state(c, n, moving, mv, dw, t):
    a = n - c
    if a < 0 or a >= 26:
        return None
    st = dict(z=CL["z"], yaw=0.0)
    if a <= 13:
        s = a
        yf = lambda sl: Y_SKID if sl <= 7 else Y_HANG  # noqa: E731
        st["x"] = lerp(car_x(s - 1), car_x(s), mv) if moving else car_x(s)
        st["y"] = lerp(yf(s - 1), yf(s), mv) if moving else yf(s)
        if not moving and s == 9:
            st["y"] = Y_HANG - (Y_HANG - Y_DIP) * (win(dw, .1, .45) - win(dw, .55, .9))
        if not moving and s == 13:
            st["y"] = Y_HANG * (1 - win(dw, .1, .75))
        st["paint"] = 1.0 if s > 6 else (win(dw, .1, .85) if s == 6 and not moving else 0.0)
        st["Engine"] = s > 9 or (s == 9 and not moving and dw >= .5)
        st["Wheels"] = s > 10 or (s == 10 and not moving and dw >= R)
        st["Finish"] = s > 11 or (s == 11 and not moving and dw >= R)
        st["Closures"] = s > 4 or (s == 4 and not moving and dw >= 0.9)
    else:
        lx, lz = LOT[c % 12]
        tau = t - (c + 14) * C
        u = smooth(tau / 8.0)
        ex = car_x(13)
        # straight to the aisle, then turn into the bay
        if u < 0.7:
            st["x"], st["z"], st["yaw"] = lerp(ex, lx, u / 0.7), CL["z"], 0.0
        else:
            f = (u - 0.7) / 0.3
            st["x"], st["z"], st["yaw"] = lx, lerp(CL["z"], lz, f), (math.pi / 2 if lz < CL["z"] else -math.pi / 2) * min(1, f * 3)
        st.update(y=0.0, paint=1.0, Engine=True, Wheels=True, Finish=True, Closures=True)
    st["Shell"] = True
    return st


def update(t):
    n, moving, mv, dw = clock(t)
    for p, pl in enumerate(pallets):
        q = (p + n) % NP
        s = DP * (q - 1 + mv + 0.5) if moving else slot_s(q)
        x, zw, yaw = loop_pos(s)
        pl["m"].set(P(x, BELT_Y, zw), yaw)
        set_parts(pl["parts"], stage_vis(q, moving, dw), pl["cache"])
    for rb in robots:
        rb.step(moving, dw)
    # hot test: engine on the stand from release until the next push
    t_rel, t_push = n * C + IDX + R * DW, n * C + IDX + 0.05 * DW
    hot_eng.show(t >= t_rel or t < t_push)
    # transfer belt
    for m in belt_engines:
        m.show(False)
    for b in range(n - BELT_M - 1, n + 1):
        tp, ta = b * C + IDX + 0.05 * DW, (b + BELT_M) * C + IDX + 0.5 * DW
        if tp <= t < ta:
            m = belt_engines[b % len(belt_engines)]
            tau = t - tp
            if tau < BELT_M * C:
                x, y, zw = belt_point(BELT_LEN * tau / (BELT_M * C))
            else:
                x, _, zw = BELT_PTS[-1]
                y = 0.6 + (Y_DIP + 0.1 - 0.6) * win((tau - BELT_M * C) / DW + .05, .15, .45)
            m.set(P(x, y, zw))
            m.show(True)
    # cars
    for i, cr in enumerate(cars):
        c = n - ((n - i) % CAR_POOL)
        st = car_state(c, n, moving, mv, dw, t)
        cr["m"].show(st is not None)
        if st is None:
            continue
        cr["m"].set(P(st["x"], st["y"], st["z"]), st["yaw"])
        paint = PAINTS[(c * 5 + 3) % len(PAINTS)]
        cr["col"].Set(Gf.Vec3f(*[lerp(BIW[k], paint[k], st["paint"]) for k in range(3)]))
        for k, prim in cr["sub"].items():
            if cr["vis"][k] != st[k]:
                img = UsdGeom.Imageable(prim)
                img.MakeVisible() if st[k] else img.MakeInvisible()
                cr["vis"][k] = st[k]
    for a in amrs:
        x, zw, yaw = route_point(a["route"], ((t * 1.6) / 140 + a["off"]) % 1.0)
        a["m"].set(P(x, 0, zw), yaw)


# ------------------------------------------------------------------ run
manifest = {k: v for k, v in assets.found.items()}
with open(args.manifest, "w", encoding="utf-8") as f:
    json.dump(dict(endpoint=args.endpoint, assets=manifest), f, indent=2, ensure_ascii=False)
print(f"[V8Plant] asset manifest -> {os.path.abspath(args.manifest)}")

_todo = sum(r.mode == "usd" and "Q" not in ROBOT_CACHE.get(r.cache_key or "", {}) for r in robots)
print(f"[V8Plant] robot trajectories: {sum(r.mode == 'usd' for r in robots)} SimReady arms, {_todo} to solve"
      + (" (first run only — a few minutes; cached afterwards)" if _todo else " (cached)"))
for rb in robots:
    rb.precompute()
    if rb.mode == "usd":
        print(f"  {rb.name:8s} {rb.kind:5s} reach {rb.arm.reach():.2f} m  taught-point error {rb.key_err * 1000:.0f} mm"
              f"  path deviation {rb.reach_err * 1000:.0f} mm  max joint step {rb.max_step:.0f} deg")
if _todo:
    try:
        with open(ROBOT_CACHE_PATH, "w", encoding="utf-8") as _f:
            json.dump(ROBOT_CACHE, _f)
    except OSError as e:
        print(f"[V8Plant] could not write robot cache: {e}")
world.reset()
for rb in robots:
    try:
        rb.initialize()
    except Exception as e:
        print(f"[{rb.name}] articulation init failed: {e}")
        rb.art = None
t_sim = 40 * C
update(t_sim)
if args.save:
    stage.GetRootLayer().Export(args.save)
    print(f"[V8Plant] stage exported -> {os.path.abspath(args.save)}")

world.play()
frame = 0
while simulation_app.is_running():
    world.step(render=True)
    if world.is_playing():
        t_sim += world.get_physics_dt() * args.speed
        update(t_sim)
    frame += 1
    if args.frames and frame >= args.frames:
        break
simulation_app.close()
