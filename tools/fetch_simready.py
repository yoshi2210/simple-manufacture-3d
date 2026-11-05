#!/usr/bin/env python3
"""
fetch_simready.py — download only the NVIDIA SimReady packages this plant uses.

Every entry below was checked against NVIDIA's official catalog (github.com/NVIDIA-Omniverse/simready-central,
`submissions/<org>/<dataset>`), and is pinned to the exact Hugging Face commit NVIDIA reviewed, so a clone
reproduces the same assets. The full SimReady library is ~480 GB; this pulls only these packages.

  python tools/fetch_simready.py                    # all groups
  python tools/fetch_simready.py --groups robots,engine
  python tools/fetch_simready.py --list-only        # show what would be downloaded
Writes assets/simready/manifest.json  (category -> local interface USD).
Licence: CC-BY-4.0 for every package listed (see NOTICE).
"""
import argparse
import json
from pathlib import Path

# category: (hf dataset, package folder, pinned commit)
PINS = {
    # --- robots
    "robot_heavy": ("Comau/N220-27", "N-220-27", "23af882268334b945e36955107603f904b83d554"),
    "robot_mid": ("Comau/S18-17", "S18-17", "248209fbe5d1bb891026f5afa55241fb472ac3e1"),
    "robot_cobot": ("FANUC-CORPORATION/SimReady-Assets", "crx10ia", "449b304714f21f81e552423fd4f6ea3a821c94c2"),
    "robot_cobot_l": ("FANUC-CORPORATION/SimReady-Assets", "crx20ia_l", "857c02c5921772046a8dc32cab5e2c13aaab9bdb"),
    "robot_ur": ("TeradyneRobotics/UniversalRobots", "ur17g_1300", "d5d8eb795a487a5c929909bc337ee4834d62b0da"),
    "gripper": ("Robotiq-Official/simready-assets", "Robotiq_2F_140", "4a7bfe12df8b89a3eabb665f092925603dc713c9"),
    "gripper_small": ("Robotiq-Official/simready-assets", "Robotiq_2F_85", "3c296ea93075d743e8ef9a0324d374b639d28123"),
    # --- engine
    "crankshaft": ("nvidia/simready-assets", "engineComponent_crankshaft_b01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "cylinder_head": ("nvidia/simready-assets", "engineComponent_cylinder_head_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "piston": ("nvidia/simready-assets", "engineComponent_cylinder_piston_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "oil_pan": ("nvidia/simready-assets", "engineComponent_engine_oil_pan_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "flywheel": ("nvidia/simready-assets", "engineComponent_flywheel_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "camshaft": ("nvidia/simready-assets", "engineComponent_camshaft_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "timing_chain": ("nvidia/simready-assets", "engineComponent_timing_chain_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "water_pump": ("nvidia/simready-assets", "engineComponent_water_pump_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "engine_mount": ("nvidia/simready-assets", "engineComponent_engine_mount_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "intake_manifold": ("nvidia/simready-assets", "fuelSystem_intake_manifold_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "exhaust_manifold": ("nvidia/simready-assets", "exhaustSystem_exhaust_manifold_c01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "transmission": ("nvidia/simready-assets", "drivetrain_transmission_auto_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "radiator": ("nvidia/simready-assets", "coolingSystem_radiator_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    # --- body
    "car_frame": ("nvidia/simready-assets", "carFrame_car_frame_assembled_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "door_front": ("nvidia/simready-assets", "bodyPart_door_front_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "door_rear": ("nvidia/simready-assets", "bodyPart_door_rear_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "hood": ("nvidia/simready-assets", "bodyPart_hood_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "fender_front": ("nvidia/simready-assets", "bodyPart_fender_front_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "bumper_front": ("nvidia/simready-assets", "bodyPart_bumper_front_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "bumper_rear": ("nvidia/simready-assets", "bodyPart_bumper_rear_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "tire": ("nvidia/simready-assets", "wheelAssembly_tire_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "wheel_rim": ("nvidia/simready-assets", "wheelAssembly_wheel_rim_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    # --- logistics
    "conveyor": ("nvidia/simready-assets", "conveyor_belt_a02", "653d91e182011f357cf1644013cc94ddf194d349"),
    "conveyor_a05": ("nvidia/simready-assets", "conveyor_belt_a05", "653d91e182011f357cf1644013cc94ddf194d349"),
    "conveyor_a08": ("nvidia/simready-assets", "conveyor_belt_a08", "653d91e182011f357cf1644013cc94ddf194d349"),
    "conveyor_a35": ("nvidia/simready-assets", "conveyor_belt_a35", "653d91e182011f357cf1644013cc94ddf194d349"),
    "conveyor_a47": ("nvidia/simready-assets", "conveyor_belt_a47", "653d91e182011f357cf1644013cc94ddf194d349"),
    "conveyor_a61": ("nvidia/simready-assets", "conveyor_belt_a61", "653d91e182011f357cf1644013cc94ddf194d349"),
    "pallet": ("nvidia/simready-assets", "pallet_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "rack": ("nvidia/simready-assets", "storageSystem_rack_heavyDuty_d01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "tire_rack": ("nvidia/simready-assets", "storage_tire_rack_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "small_load_carrier": ("ForgeCAD/simready-assets", "small_load_carrier", "0573053fa2c9174ca2a4678a462ec4dfd3035d59"),
    "crate": ("nvidia/simready-assets", "crate_blue_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "box": ("nvidia/simready-assets", "box_cardboard_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "parts_cart": ("nvidia/simready-assets", "equipment_multi_tier_bin_cart_c01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "pallet_jack": ("nvidia/simready-assets", "palletJack_heavyDuty_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "lift_table": ("nvidia/simready-assets", "equipment_liftTable_scissorMobile_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "transmission_jack": ("nvidia/simready-assets", "vehicleSupport_transmission_jack_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
    "parcel_chute": ("ForgeCAD/simready-assets", "spiral_parcel_chute", "89e7d32a159221dce50eeb25ed294a36340bffb8"),
    # --- facility
    "fence": ("nvidia/simready-assets", "barrier_fence_metal_a02", "653d91e182011f357cf1644013cc94ddf194d349"),
    "safety_gate": ("nvidia/simready-assets", "barrier_gate_safety_a02", "653d91e182011f357cf1644013cc94ddf194d349"),
    "cone": ("ForgeCAD/simready-assets", "traffic_cones_barriers", "11da4ca51b2bd4b44d2ba7a5f46bb37342615e42"),
    "air_compressor": ("nvidia/simready-assets", "equipment_airCompressor_a01", "653d91e182011f357cf1644013cc94ddf194d349"),
}
GROUPS = {
    "robots": [
        "robot_heavy",
        "robot_mid",
        "robot_cobot",
        "robot_cobot_l",
        "robot_ur",
        "gripper",
        "gripper_small"
    ],
    "engine": [
        "crankshaft",
        "cylinder_head",
        "piston",
        "oil_pan",
        "flywheel",
        "camshaft",
        "timing_chain",
        "water_pump",
        "engine_mount",
        "intake_manifold",
        "exhaust_manifold",
        "transmission",
        "radiator"
    ],
    "body": [
        "car_frame",
        "door_front",
        "door_rear",
        "hood",
        "fender_front",
        "bumper_front",
        "bumper_rear",
        "tire",
        "wheel_rim"
    ],
    "logistics": [
        "conveyor",
        "conveyor_a05",
        "conveyor_a08",
        "conveyor_a35",
        "conveyor_a47",
        "conveyor_a61",
        "pallet",
        "rack",
        "tire_rack",
        "small_load_carrier",
        "crate",
        "box",
        "parts_cart",
        "pallet_jack",
        "lift_table",
        "transmission_jack",
        "parcel_chute"
    ],
    "facility": [
        "fence",
        "safety_gate",
        "cone",
        "air_compressor"
    ]
}
SKIP_DIRS = ("payloads", "source_assets", ".thumbs", "materials", "textures", "licenses", ".metadata")


def interface_usd(root: Path):
    """The package's root USD: <folder>/<intermediate>/<name>.usd (never a payload/material layer)."""
    cands = [p for p in root.rglob("*") if p.suffix.lower() in (".usd", ".usda", ".usdc", ".usdz")
             and not any(s in (x.lower() for x in p.relative_to(root).parts[:-1]) for s in SKIP_DIRS)]
    return min(cands, key=lambda p: (len(p.relative_to(root).parts), len(p.name))) if cands else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="assets/simready")
    ap.add_argument("--groups", default=",".join(GROUPS))
    ap.add_argument("--list-only", action="store_true")
    a = ap.parse_args()
    cats = [c for g in a.groups.split(",") for c in GROUPS[g.strip()]]
    if a.list_only:
        for c in cats:
            r, f, v = PINS[c]
            print(f"{c:20s} {r}/{f}@{v[:8]}")
        return
    from huggingface_hub import snapshot_download
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    man_path = out / "manifest.json"
    manifest = json.loads(man_path.read_text()) if man_path.exists() else {"assets": {}, "packages": {}}
    for c in cats:
        repo, folder, rev = PINS[c]
        dest = out / repo.replace("/", "__")
        print(f"[{c}] {repo}/{folder}@{rev[:8]}")
        snapshot_download(repo, repo_type="dataset", revision=rev, allow_patterns=[f"{folder}/**"], local_dir=str(dest))
        usd = interface_usd(dest / folder)
        if usd is None:
            print(f"  ! no interface USD found in {folder}")
            continue
        manifest["assets"][c] = str(usd.resolve())
        manifest["packages"][c] = f"https://huggingface.co/datasets/{repo}/tree/{rev}/{folder}"
        print(f"  -> {usd.relative_to(out)}")
        man_path.write_text(json.dumps(manifest, indent=2))
    print(f"manifest: {man_path} ({len(manifest['assets'])} assets)")


if __name__ == "__main__":
    main()
