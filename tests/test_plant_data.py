"""Consistency checks for data/plant.json (the BOM + BOP shared by the web and Isaac Sim versions)."""
import json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
P = json.loads((ROOT / "data" / "plant.json").read_text(encoding="utf-8"))
sys.path.insert(0, str(ROOT / "tools"))
from fetch_simready import PINS  # noqa: E402
meta, parts = P["meta"], P["parts"]
avail = meta["takt_s"] - meta["transfer_s"]
for line in P["lines"].values():
    for st in line["stations"]:
        work = sum(o["t"] for o in st["ops"])
        assert st.get("offline") or work <= avail + 1e-9, (st["id"], work, avail)
        for pid, q in st["installs"]:
            assert pid in parts and q > 0, (st["id"], pid)
for pid, p in parts.items():
    assert p["asset"] is None or p["asset"] in PINS, (pid, p["asset"])
for grp in P["ebom"]["VEHICLE"]:
    for pid, q in grp["children"]:
        assert pid in parts, pid
slots = [st["slot"] for st in P["lines"]["vehicle"]["stations"]]
assert slots == list(range(len(slots))), slots
assert [st["id"] for st in P["lines"]["v8"]["stations"][:10]] == [f"ST{i * 10}" for i in range(1, 11)]
print(f"plant.json ok: {sum(len(l['stations']) for l in P['lines'].values())} stations, {len(parts)} parts, "
      f"{sum(1 for p in parts.values() if p['asset'])} mapped to SimReady packages")
