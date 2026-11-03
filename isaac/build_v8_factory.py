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
from pxr import Gf, Sdf, Usd, UsdGeom, UsdLux, UsdShade  # noqa: E402
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
C, IDX = 9.0, 2.2                      # cycle time, index-move time (s)
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


_up_cache = {}


def asset_is_y_up(usd):
    if usd not in _up_cache:
        try:
            st = Usd.Stage.Open(usd, load=Usd.Stage.LoadNone)
            _up_cache[usd] = UsdGeom.GetStageUpAxis(st) == UsdGeom.Tokens.y
        except Exception:
            _up_cache[usd] = False
    return _up_cache[usd]


def world_range(prim):
    cache = UsdGeom.BBoxCache(Usd.TimeCode.Default(), [UsdGeom.Tokens.default_, UsdGeom.Tokens.render])
    return cache.ComputeWorldBound(prim).ComputeAlignedRange()


def bbox_size(prim):
    r = world_range(prim)
    return r.GetSize() if not r.IsEmpty() else Gf.Vec3d(1, 1, 1)


def reference(path, usd, pos, yaw=0.0, fit=None, force_fit=False, snap=True):
    """Reference a SimReady USD and normalise it: Y-up -> Z-up, unit fix (or exact fit), centre on pos, sit on pos.z.

    fit: expected largest horizontal size in metres. The asset is rescaled when its size is off by >2.5x
    (a units mismatch such as cm vs m), or always when force_fit=True.
    """
    add_reference_to_stage(usd_path=usd, prim_path=path)
    prim = stage.GetPrimAtPath(path)
    x = UsdGeom.Xformable(prim)
    x.ClearXformOpOrder()
    t = x.AddTranslateOp()
    t.Set(Gf.Vec3d(*pos))
    x.AddRotateZOp().Set(math.degrees(yaw))
    if not args.no_axis_fix and asset_is_y_up(usd):
        x.AddRotateXOp().Set(90.0)
    sc = x.AddScaleOp()
    sc.Set(Gf.Vec3f(1, 1, 1))
    if fit:
        size = bbox_size(prim)
        m = max(size[0], size[1])
        if m > 1e-6:
            k = fit / m
            if force_fit or not (0.4 < k < 2.5):
                sc.Set(Gf.Vec3f(k, k, k))
    if snap:
        r = world_range(prim)
        if not r.IsEmpty():
            c = r.GetMidpoint()
            t.Set(Gf.Vec3d(pos[0] + (pos[0] - c[0]), pos[1] + (pos[1] - c[1]), pos[2] + (pos[2] - r.GetMin()[2])))
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
    """Creates an engine Xform with one child Xform per assembly stage. Returns (root Mover, [part prims])."""
    root = Mover(path)
    s = ES
    parts = []
    eng_usd = assets.simready("engine")
    for i, name in enumerate(ENGINE_PARTS):
        pp = f"{path}/{name}"
        UsdGeom.Xform.Define(stage, pp)
        parts.append(stage.GetPrimAtPath(pp))
    if eng_usd:  # use the SimReady engine as the bare block
        reference(f"{path}/Block/SimReady", eng_usd, (0, 0, 0), fit=0.96, force_fit=True)
    else:
        bx(f"{path}/Block/case", 1.2 * s, 0.42 * s, 0.62 * s, 0, 0.35 * s, 0, MAT["alu"])
        bx(f"{path}/Block/pan", 1.1 * s, 0.16 * s, 0.5 * s, 0, 0.08 * s, 0, MAT["dark"])
        for side in (-1, 1):
            bx(f"{path}/Block/bank{side + 1}", 1.15 * s, 0.46 * s, 0.3 * s, 0, 0.66 * s, 0.2 * s * side, MAT["alu"], rot_x=45 * side)
    cyl(f"{path}/Crank/shaft", 0.05 * s, 1.36 * s, (0, 0, 0.3 * s), MAT["steel"], "X")
    cyl(f"{path}/Crank/flywheel", 0.3 * s, 0.05 * s, (-0.66 * s, 0, 0.3 * s), MAT["dark"], "X")
    cyl(f"{path}/Crank/pulley", 0.15 * s, 0.08 * s, (0.7 * s, 0, 0.3 * s), MAT["black"], "X")
    deck = lambda side, h: (0.66 + h * 0.707) * s, lambda side, h: (0.2 + h * 0.707) * s * side  # noqa: E731
    for k, side in ((2, -1), (3, 1)):
        for i in range(4):
            x = (-0.42 + i * 0.28) * s
            cyl(f"{path}/{ENGINE_PARTS[k]}/p{i}", 0.088 * s, 0.05 * s, P(x, deck[0](side, 0.25), deck[1](side, 0.25)), MAT["steel"])
    for k, side in ((4, -1), (5, 1)):
        bx(f"{path}/{ENGINE_PARTS[k]}/head", 1.15 * s, 0.16 * s, 0.34 * s, 0, deck[0](side, 0.32), deck[1](side, 0.32), MAT["dark"], rot_x=45 * side)
        bx(f"{path}/{ENGINE_PARTS[k]}/exhaust", 1.0 * s, 0.11 * s, 0.11 * s, 0, 0.62 * s, 0.52 * s * side, MAT["rust"])
    bx(f"{path}/Intake/plenum", 0.9 * s, 0.14 * s, 0.26 * s, 0, 1.0 * s, 0, MAT["steel"])
    bx(f"{path}/Intake/cap", 0.82 * s, 0.04 * s, 0.2 * s, 0, 1.09 * s, 0, MAT["red"])
    for side in (-1, 1):
        bx(f"{path}/Covers/vc{side + 1}", 1.08 * s, 0.1 * s, 0.28 * s, 0, deck[0](side, 0.45), deck[1](side, 0.45), MAT["red"], rot_x=45 * side)
    bx(f"{path}/Covers/timing", 0.06 * s, 0.62 * s, 0.7 * s, 0.62 * s, 0.55 * s, 0, MAT["black"])
    return root, parts


def set_parts(parts, vis, cache):
    for i, p in enumerate(parts):
        if cache[i] != vis[i]:
            img = UsdGeom.Imageable(p)
            img.MakeVisible() if vis[i] else img.MakeInvisible()
            cache[i] = vis[i]


# ------------------------------------------------------------------ V8 line: conveyor + pallets
conv_usd = assets.simready("conveyor")
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
            reference(f"{ROOT}/V8Line/{lane}_{i}", conv_usd, P(V8["x0"] + (i + 0.5) * seg, 0, z),
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
        reference(f"{pm.path}/Body", pal_usd, (0, 0, 0), fit=1.9, force_fit=True)
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
UR10_LINKS = dict(a2=0.612, a3=0.5723, d1=0.1273, tool=0.25)


class LineRobot:
    """Industrial arm doing a timed pick -> place cycle every dwell."""

    def __init__(self, name, base, pick, place, color="orange", pedestal=0.6):
        self.name, self.base, self.pick, self.place = name, np.array(base, float), np.array(pick, float), np.array(place, float)
        self.path = f"{ROOT}/Robots/{name}"
        usd, self.kind = assets.robot()
        cube(f"{ROOT}/Robots/{name}_pedestal", (0.6, 0.6, pedestal), (base[0], base[1], pedestal / 2), MAT["grey"])
        self.base[2] = pedestal
        self.art, self.ik = None, None
        if usd:
            reference(self.path, usd, tuple(self.base), yaw=0.0)
        else:  # no robot asset at all -> static placeholder
            cube(self.path, (0.5, 0.5, 1.6), (base[0], base[1], pedestal + 0.8), MAT[color])

    def initialize(self):
        if self.kind == "none":
            return
        self.art = SingleArticulation(prim_path=self.path, name=self.name)
        self.art.initialize()
        if self.kind == "ur10":
            try:
                from isaacsim.robot_motion.motion_generation import (ArticulationKinematicsSolver,
                                                                     LulaKinematicsSolver, interface_config_loader)
                cfg = interface_config_loader.load_supported_lula_kinematics_solver_config("UR10")
                lula = LulaKinematicsSolver(**cfg)
                lula.set_robot_base_pose(self.base, np.array([1.0, 0, 0, 0]))
                self.ik = ArticulationKinematicsSolver(self.art, lula, "ee_link")
            except Exception as e:
                print(f"[{self.name}] Lula IK unavailable ({e}); using analytic choreography")

    def target(self, dw):
        """tool-tip target for this dwell fraction (dw<0 = home)."""
        home = (self.pick + self.place) / 2 + np.array([0, 0, 0.6])
        if dw < 0:
            return home
        lift = np.array([0, 0, 0.35])
        keys = [(0, home), (.14, self.pick + lift), (.22, self.pick), (.30, self.pick), (.38, self.pick + lift),
                (.58, self.place + lift), (.64, self.place), (.72, self.place), (.80, self.place + lift), (1, home)]
        for (ta, a), (tb, b) in zip(keys, keys[1:]):
            if dw < tb:
                return a + (b - a) * smooth((dw - ta) / (tb - ta))
        return home

    def analytic(self, tgt):
        """UR-style joint choreography (tool pointing down). Works for UR10; approximate for other 6-axis arms."""
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
        k = min(6, len(q))
        q[:k] = vals[:k]
        return q

    def step(self, moving, dw):
        if self.art is None:
            return
        tgt = self.target(-1 if moving else dw)
        if self.ik is not None:
            action, ok = self.ik.compute_inverse_kinematics(tgt, np.array([0, 1.0, 0, 0]))
            if ok:
                self.art.apply_action(action)
                return
        self.art.apply_action(ArticulationAction(joint_positions=self.analytic(tgt)))


def lane_y(zw): return -zw   # web z -> Isaac y


robots = []
REACH_OFF = 1.15  # base offset from the lane for a UR10-class arm (scale up for larger SimReady arms)
for i in range(8):
    x = slot_x(i)
    place = (x, lane_y(V8["zt"]) + 0.2, BELT_Y + 0.12 + 0.75)
    base = (x, lane_y(V8["zt"]) + REACH_OFF + 0.2, 0)
    pick = (x - 0.9, base[1] + 0.3, 1.05)
    cube(f"{ROOT}/V8Line/Table_{i}", (0.8, 0.7, 0.85), (pick[0], pick[1], 0.425), MAT["grey"])
    crate = assets.simready("crate")
    if crate:
        reference(f"{ROOT}/V8Line/Crate_{i}", crate, (pick[0] - 0.9, pick[1], 0), fit=0.6)
    robots.append(LineRobot(f"ST{(i + 1) * 10}", base, pick, place))
robots.append(LineRobot("ST100_Unload", (XU - 0.9, lane_y(-3.2), 0), (XU, lane_y(V8["zt"]), BELT_Y + 0.9),
                        (XU, lane_y(-1.4), 1.85)))
for s in range(4):
    for side in (-1, 1):
        bxw = car_x(s)
        place = (bxw, lane_y(CL["z"]) - side * 0.95, Y_SKID + 1.0)
        robots.append(LineRobot(f"Weld_{s}_{'L' if side < 0 else 'R'}", (bxw, lane_y(CL["z"]) - side * 1.9, 0),
                                (bxw - 0.6, place[1], 1.0), place, color="red", pedestal=0.4))
for side in (-1, 1):
    x = car_x(10)
    robots.append(LineRobot(f"Wheel_{'L' if side < 0 else 'R'}", (x, lane_y(CL["z"]) - side * 1.9, 0),
                            (x, lane_y(CL["z"]) - side * 2.9, 1.2), (x + 1.4, lane_y(CL["z"]) - side * 0.86, Y_HANG + 0.34),
                            pedestal=0.9))
robots.append(LineRobot("Glass", (car_x(11), lane_y(CL["z"]) - 1.9, 0), (car_x(11) + 1.0, lane_y(CL["z"]) - 2.9, 1.3),
                        (car_x(11) + 0.63, lane_y(CL["z"]), Y_HANG + 1.3), pedestal=1.2))

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
    m = Mover(path)
    sub = {}
    for k in ("Shell", "Finish", "Wheels", "Engine"):
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
    if frame:  # SimReady body-in-white frame instead of the box shell
        reference(f"{path}/Shell/frame", frame, (0, 0, 0.25), fit=4.4, force_fit=True)
        bx(f"{path}/Finish/hood", 1.3, 0.05, 1.62, 1.58, 1.08, 0, pm)
        bx(f"{path}/Finish/windshield", 0.03, 0.66, 1.52, 0.63, 1.28, 0, MAT["glass"])
        _wheels_and_engine(path)
        return dict(m=m, sub=sub, col=col, vis={k: True for k in sub})
    bx(f"{path}/Shell/floor", 3.1, 0.3, 1.8, -0.65, 0.4, 0, pm)
    bx(f"{path}/Shell/rear", 1.1, 0.5, 1.8, -1.7, 0.8, 0, pm)
    bx(f"{path}/Shell/roof", 1.7, 0.07, 1.62, -0.42, 1.52, 0, pm)
    for side in (-1, 1):
        n = "L" if side < 0 else "R"
        bx(f"{path}/Shell/door{n}", 2.0, 0.5, 0.1, -0.15, 0.8, 0.85 * side, pm)
        bx(f"{path}/Shell/fender{n}", 1.3, 0.42, 0.14, 1.58, 0.8, 0.83 * side, pm)
        bx(f"{path}/Shell/bpillar{n}", 0.1, 0.46, 0.08, -0.3, 1.28, 0.8 * side, pm)
    bx(f"{path}/Shell/firewall", 0.1, 0.5, 1.6, 0.92, 0.8, 0, pm)
    bx(f"{path}/Shell/bumper", 0.14, 0.4, 1.8, 2.25, 0.62, 0, pm)
    bx(f"{path}/Finish/hood", 1.3, 0.05, 1.62, 1.58, 1.08, 0, pm)
    bx(f"{path}/Finish/windshield", 0.03, 0.66, 1.52, 0.63, 1.28, 0, MAT["glass"])
    _wheels_and_engine(path)
    return dict(m=m, sub=sub, col=col, vis={k: True for k in sub})


def _wheels_and_engine(path):
    tire = assets.simready("tire")
    for i, (wx, wz) in enumerate(((1.4, -0.86), (-1.4, -0.86), (1.4, 0.86), (-1.4, 0.86))):
        if tire:
            reference(f"{path}/Wheels/w{i}", tire, P(wx, 0.0, wz), fit=0.68, force_fit=True)
        else:
            cyl(f"{path}/Wheels/w{i}", 0.34, 0.24, P(wx, 0.34, wz), MAT["black"], "Y")
    bx(f"{path}/Engine/block", 0.9, 0.7, 0.7, 1.55, 0.45, 0, MAT["alu"])
    bx(f"{path}/Engine/covers", 0.86, 0.1, 0.8, 1.55, 0.85, 0, MAT["red"])


CAR_POOL = 30
cars = [build_car(f"{ROOT}/CarLine/Car_{i:02d}") for i in range(CAR_POOL)]

# finished-vehicle yard + logistics decor from SimReady
LOT = [(37 + (i % 6) * 3.5, 15.2 if i >= 6 else 0.8) for i in range(12)]
veh = assets.simready("vehicle")
if veh:  # a few SimReady cars parked as display in front of the yard
    for i in range(3):
        reference(f"{ROOT}/Yard/Display_{i}", veh, P(40 + i * 5, 0, 21), yaw=math.pi / 2, fit=4.6)
DECOR = [("rack", -40, -21, 0, 3.0), ("rack", -30, -21, 0, 3.0), ("tire_rack", car_x(10) + 1, 14.5, 0, 2.0), ("small_load_carrier", -12, -8.5, 0, 0.6), ("lift_table", 10, -8.6, 0, 1.6),
         ("air_compressor", XU + 3.5, -2.5, 0, 1.5), ("parts_cart", car_x(10) + 3, 13.5, 0, 1.2), ("parts_cart", car_x(11) + 3, 13.5, 0, 1.2),
         ("safety_gate", V8["x0"] - 6, -15, math.pi / 2, 2.0)]
DECOR += [("fence", x, V8["zb"] - 3.0, 0, 2.4) for x in range(int(V8["x0"]) - 4, int(V8["x0"] + V8["S"]) + 6, 3)]
for i, (key, x, zw, yaw, fit) in enumerate(DECOR):
    usd = assets.simready(key)
    if usd:
        reference(f"{ROOT}/Decor/{key}_{i}", usd, P(x, 0, zw), yaw=yaw, fit=fit)

amr_usd = assets.simready("amr")
AMR_ROUTES = [[(-30, -15.6), (32, -15.6), (32, -17.6), (-30, -17.6)], [(-60, 2.4), (-6, 2.4), (-6, 0.6), (-60, 0.6)]]
amrs = []
for ri, route in enumerate(AMR_ROUTES):
    for k in range(2):
        m = Mover(f"{ROOT}/AMR/amr_{ri}_{k}")
        if amr_usd:
            reference(f"{m.path}/Body", amr_usd, (0, 0, 0), fit=1.4)
        else:
            cube(f"{m.path}/Body", (1.4, 0.9, 0.35), (0, 0, 0.22), MAT["white"])
            box_usd = assets.simready("box")
            if box_usd:
                reference(f"{m.path}/Load", box_usd, (0, 0, 0.4), fit=0.8)
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
        st.update(y=0.0, paint=1.0, Engine=True, Wheels=True, Finish=True)
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
sys.exit(0)
