#!/usr/bin/env python3
"""
fetch_simready.py — 工場に必要な NVIDIA SimReady アセットだけを Hugging Face から取得する。

SimReady Assets データセット全体は約 480 GB あるため、カテゴリごとに 1 フォルダだけを選んで
ダウンロードし、`assets/simready/manifest.json` に「カテゴリ → ローカル USD パス」を書き出します。
build_v8_factory.py はこの manifest を読んで工場を組み立てます。

解決の順番（カテゴリごと）:
  1. PREFERRED に書いたフォルダ名がデータセットにあればそれを使う
  2. なければ PATTERNS の正規表現でデータセットのフォルダ一覧から最初の一致を選ぶ
  3. --search を付けた場合は simready-search（USD Search）の自然言語検索も試す

使い方:
  python tools/fetch_simready.py                 # 解決してダウンロード
  python tools/fetch_simready.py --list-only     # 解決結果だけ表示（ダウンロードしない）
  HF_TOKEN=... python tools/fetch_simready.py    # レート制限を避けたい場合
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

REPO_CANDIDATES = ["nvidia/simready-assets", "ml-resources/simready-assets"]

# category -> preferred folder names (confirmed to exist in the dataset listing, Nov 2026)
PREFERRED = {
    "conveyor": ["conveyor_belt_a02", "conveyor_belt_a05", "conveyor_belt_a08"],
    "car_frame": ["carFrame_car_frame_assembled_a01"],
    "crate": ["crate_blue_a01", "crate_gray_a08", "crate_yellow_a01"],
    "fence": ["barrier_fence_metal_a02", "barrier_fence_metal_a03"],
    "safety_gate": ["barrier_gate_safety_a02"],
    "cart": ["cart_mobile_a01", "cart_mobile_b01"],
    "box": ["box_cardboard_a01", "box_corrugated_brown_b04"],
    "bin": ["bin_waste_a01"],
    "compressor": ["airSystem_compressor_a01"],
}
# category -> regex over top-level folder names (fallback when no preferred folder exists)
PATTERNS = {
    "conveyor": r"^conveyor",
    "car_frame": r"car_?frame",
    "pallet": r"^pallet",
    "rack": r"^(rack|shelving|shelf)",
    "crate": r"^crate_",
    "fence": r"^barrier_fence",
    "safety_gate": r"^barrier_gate",
    "cart": r"^cart_",
    "tire": r"(^|_)(tire|tyre)(_|$)",
    "forklift": r"forklift",
    "table": r"(workbench|worktable|table_work|table_metal|table_industrial)",
    "cone": r"cone",
    "box": r"^box_cardboard",
    "bin": r"^bin_",
    "compressor": r"compressor",
}
SEARCH_QUERIES = {
    "robot_arm": "6-axis industrial robot arm",
    "amr": "autonomous mobile robot",
    "pallet": "pallet",
    "rack": "industrial shelving rack",
    "tire": "car tire",
    "forklift": "forklift",
}
USD_EXT = (".usd", ".usda", ".usdc", ".usdz")


def pick_repo(api):
    for rid in REPO_CANDIDATES:
        try:
            api.dataset_info(rid)
            return rid
        except Exception as e:  # missing / gated / renamed
            print(f"  - {rid}: unavailable ({type(e).__name__})")
    sys.exit("SimReady dataset not reachable. Check network / HF_TOKEN.")


def list_folders(api, repo):
    from huggingface_hub import RepoFolder
    return sorted(e.path for e in api.list_repo_tree(repo, repo_type="dataset", recursive=False) if isinstance(e, RepoFolder))


def resolve(folders, cats):
    fs = set(folders)
    out = {}
    for cat in cats:
        hit = next((f for f in PREFERRED.get(cat, []) if f in fs), None)
        if not hit and cat in PATTERNS:
            rx = re.compile(PATTERNS[cat], re.I)
            hit = next((f for f in folders if rx.search(f)), None)
        out[cat] = hit
    return out


def main_usd(api, repo, folder):
    files = [e.path for e in api.list_repo_tree(repo, path_in_repo=folder, repo_type="dataset", recursive=True)
             if e.path.lower().endswith(USD_EXT)]
    if not files:
        return None
    name = folder.split("/")[-1].lower()

    def rank(p):
        base = Path(p).stem.lower()
        return (0 if base == name else 1, 0 if "payload" not in p.lower() else 1, p.count("/"), len(p))
    return sorted(files, key=rank)[0]


def search_fallback(cats, endpoint):
    found = {}
    try:
        from simready.search import AssetLibrary, SearchFilterLLMQuery
        lib = AssetLibrary()
        lib.add_service_source(endpoint)
    except Exception as e:
        print(f"  simready-search unavailable: {e}")
        return found
    for cat in cats:
        q = SEARCH_QUERIES.get(cat)
        if not q:
            continue
        try:
            for h in lib.search(include_all=[SearchFilterLLMQuery(q)]):
                p = str(h.asset_path)
                if p.lower().endswith(USD_EXT):
                    found[cat] = p
                    break
        except Exception as e:
            print(f"  search '{cat}' failed: {e}")
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="assets/simready")
    ap.add_argument("--list-only", action="store_true")
    ap.add_argument("--search", action="store_true", help="also query simready-search for categories not in the dataset")
    ap.add_argument("--endpoint", default=os.environ.get("SIMREADY_ENDPOINT", "https://nvidia-simready-central.hf.space"))
    ap.add_argument("--categories", default=",".join(sorted(set(PATTERNS) | set(PREFERRED))))
    a = ap.parse_args()

    from huggingface_hub import HfApi, snapshot_download
    api = HfApi()
    print("[1/4] SimReady dataset")
    repo = pick_repo(api)
    print(f"  using {repo}")
    print("[2/4] listing folders")
    folders = list_folders(api, repo)
    print(f"  {len(folders)} asset folders")
    cats = [c.strip() for c in a.categories.split(",") if c.strip()]
    chosen = resolve(folders, cats)
    print("[3/4] resolved")
    for c in cats:
        print(f"  {c:12s} -> {chosen[c] or '-'}")

    out = Path(a.out)
    manifest = {"dataset": repo, "license": "CC-BY-4.0 (NVIDIA SimReady Assets)", "assets": {}, "folders": {}}
    if a.list_only:
        manifest["folders"] = chosen
        print(json.dumps(manifest, indent=2))
        return
    out.mkdir(parents=True, exist_ok=True)
    print("[4/4] downloading")
    for cat, folder in chosen.items():
        if not folder:
            continue
        usd = main_usd(api, repo, folder)
        if not usd:
            print(f"  {cat}: no USD in {folder}, skipped")
            continue
        snapshot_download(repo, repo_type="dataset", allow_patterns=[f"{folder}/**"], local_dir=str(out))
        manifest["assets"][cat] = str((out / usd).resolve())
        manifest["folders"][cat] = folder
        print(f"  {cat:12s} ok  {usd}")
    if a.search:
        missing = [c for c in SEARCH_QUERIES if c not in manifest["assets"]]
        for cat, p in search_fallback(missing, a.endpoint).items():
            manifest["assets"][cat] = p  # remote path (hf:// or https) — referenced directly by Isaac Sim
            print(f"  {cat:12s} search -> {p}")
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    print(f"manifest -> {out / 'manifest.json'}")


if __name__ == "__main__":
    main()
