"""Consistency checks for mini4wd/data/company.json — the same formulas the web app uses (web/main.js: costRollup, capacity)."""
import json
from pathlib import Path
D = json.loads((Path(__file__).resolve().parents[1] / "data" / "company.json").read_text(encoding="utf-8"))
m, R, des = D["meta"], D["regulation"], D["design"]
parts = {p["pn"]: p for p in D["parts"]}

# --- regulation envelope
assert des["length"] <= R["length_max"] and des["width_rollers"] <= R["width_max"] and des["height"] <= R["height_max"]
assert R["tire_dia"][0] <= des["tire_dia"] <= R["tire_dia"][1] and R["tire_width"][0] <= des["tire_width"] <= R["tire_width"][1]
assert des["ground"] >= R["ground_min"]
car_g = sum(p["weight_g"] * p["qty"] for p in D["parts"] if not p.get("ship_only"))
total_g = car_g + des["battery_mass_g"] * des["battery_count"]
assert total_g >= R["weight_min_g"], total_g

# --- assembly: every station fits takt, every non-shipping part is installed exactly once
for st in D["assembly"]["stations"]:
    t = sum(o["t"] for o in st["ops"])
    assert t <= m["takt_s"], (st["id"], t)
inst = [pn for v in D["installs"].values() for pn in v]
assert sorted(inst) == sorted(parts), set(inst) ^ set(parts)

# --- capacity
rate_h = 3600 / m["takt_s"]
for mc in D["molding"]:
    for pn in mc["parts"]:
        p = parts[pn]
        cap = 3600 / p["cycle_s"] * p["cavities"] / p["qty"]
        assert cap >= rate_h, (mc["id"], pn, cap, rate_h)
smt_cap = 3600 / D["smt"]["panel_cycle_s"] * D["smt"]["panel_up"]
assert smt_cap >= rate_h

# --- cost roll-up (identical to web/main.js costRollup)
def molded_cost(p):
    mat = p["weight_g"] * (1 + p["runner_ratio"]) / 1000 * p["resin_yen_kg"]
    ton = next(str(mc["tonnage"]) for mc in D["molding"] if mc["id"] == p["machine"])
    machine = D["molding_rate_yen_h"][ton] * p["cycle_s"] / 3600 / p["cavities"]
    mold = (p["mold_cost"] / p["mold_life_shots"] / p["cavities"]) if p["mold_cost"] else 0
    return mat + machine + mold
def unit_cost(p):
    if p["make_buy"] == "購入":
        return p["unit_cost"]
    if p.get("smt"):
        comp = sum(c["cost"] * c["qty"] for c in D["pcb_bom"])
        return comp + D["smt"]["line_rate_yen_h"] * D["smt"]["panel_cycle_s"] / 3600 / D["smt"]["panel_up"]
    if "machine_rate" in p:
        return p["sheet_yen"] + p["machine_rate"] * p["cycle_s"] / 3600
    return molded_cost(p)
material = sum(unit_cost(p) * p["qty"] for p in D["parts"])
cm = D["cost_model"]; a = D["assembly"]
labor = (a["line_rate_yen_h"] + a["operator_rate_yen_h"] * a["operators"]) * m["takt_s"] / 3600
overhead = (material + labor) * cm["overhead_rate"]
total = material + labor + overhead + cm["logistics_per_unit"] + cm["warranty_per_unit"]
print(f"weight: car {car_g:.1f} g + batteries = {total_g:.1f} g (min {R['weight_min_g']})")
print(f"rate {rate_h:.0f}/h, SMT capacity {smt_cap:.0f}/h")
print(f"cost: material {material:.0f}  labor {labor:.0f}  overhead {overhead:.0f}  total {total:.0f}  target {cm['target_cost']}")
for v in D["variants"]:
    net = v["msrp"] / (1 + cm["tax_rate"]) * (1 - cm["channel_margin"])
    print(f"  {v['id']}: MSRP {v['msrp']}  net {net:.0f}  GM {(net - total) / net * 100:.0f}%")
assert total <= cm["target_cost"] * 1.05, total
# --- FMEA / control plan sanity
for f in D["dfmea"] + D["pfmea"]:
    assert all(1 <= f[k] <= 10 for k in "SOD"), f
for c in D["control_plan"]:
    assert c["usl"] is not None and (c["lsl"] is None or c["lsl"] < c["usl"])
assert len(D["ppap"]) == 18
print("company.json ok")
