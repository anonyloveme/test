"""Validate tour_manifest.json integrity before upload/deploy.

Exit code:
- 0: manifest valid (no FAIL checks)
- 1: manifest invalid (one or more FAIL checks)
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT_DIR / "tour_manifest.json"
TILES_DIR = ROOT_DIR / "tiles"
PREVIEW_DIR = ROOT_DIR / "preview"
PANORAMA_DIRS = [
    ROOT_DIR / "Anh360",
    ROOT_DIR / "output_tour",
    ROOT_DIR / "panoramas",
]

TOP_LEVEL_KEYS = {
    "tour_name",
    "generated_at",
    "camera",
    "projection",
    "resolution",
    "total_nodes",
    "tile_format",
    "mapbox",
    "nodes",
}

NODE_REQUIRED_KEYS = {
    "id",
    "scene_folder",
    "name",
    "filename",
    "url",
    "thumbnail",
    "tiles_url",
    "tile_url_pattern",
    "tile_format",
    "tile_info",
    "gps",
    "heading",
    "type",
    "confidence",
    "hotspots",
}

VALID_TYPES = {"merged", "standalone"}
VALID_CONFIDENCE = {"HIGH", "MEDIUM", "original"}


@dataclass
class Reporter:
    passed: int = 0
    warnings: int = 0
    failed: int = 0

    def ok(self, description: str) -> None:
        self.passed += 1
        print(f"✅ PASS  — {description}")

    def warn(self, description: str, detail: str | None = None) -> None:
        self.warnings += 1
        if detail:
            print(f"⚠️  WARN  — {description} ({detail})")
        else:
            print(f"⚠️  WARN  — {description}")

    def fail(self, description: str, detail: str | None = None) -> None:
        self.failed += 1
        if detail:
            print(f"❌ FAIL  — {description} ({detail})")
        else:
            print(f"❌ FAIL  — {description}")


def load_manifest(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError("Manifest root must be an object")
    return payload


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def preview_candidate_exists(scene_folder: str) -> bool:
    if not PREVIEW_DIR.exists():
        return False

    strict = PREVIEW_DIR / f"{scene_folder}_thumb.jpg"
    if strict.exists():
        return True

    for candidate in PREVIEW_DIR.glob("*.jpg"):
        if candidate.name.startswith(scene_folder):
            return True
    return False


def any_tile_exists(scene_folder: str) -> bool:
    folder = TILES_DIR / scene_folder
    if not folder.exists() or not folder.is_dir():
        return False
    return any(folder.rglob("*.jpg"))


def asset_exists(filename: str) -> tuple[bool, str]:
    for directory in PANORAMA_DIRS:
        candidate = directory / filename
        if candidate.exists():
            return True, candidate.as_posix()
    return False, ""


def main() -> int:
    report = Reporter()

    if not MANIFEST_PATH.exists():
        report.fail("Manifest file exists", MANIFEST_PATH.as_posix())
        print("\nPASSED: 0  WARNINGS: 0  FAILED: 1")
        print("Manifest is INVALID")
        return 1

    try:
        manifest = load_manifest(MANIFEST_PATH)
    except Exception as exc:  # noqa: BLE001 - CLI diagnostics
        report.fail("Manifest JSON is readable", str(exc))
        print(f"\nPASSED: {report.passed}  WARNINGS: {report.warnings}  FAILED: {report.failed}")
        print("Manifest is INVALID")
        return 1

    print(f"Validating manifest: {MANIFEST_PATH.as_posix()}")

    # STRUCTURE CHECKS
    missing_top = sorted(TOP_LEVEL_KEYS - set(manifest.keys()))
    if missing_top:
        report.fail("Top-level keys present", ", ".join(missing_top))
    else:
        report.ok("Top-level keys present")

    nodes = manifest.get("nodes")
    if not isinstance(nodes, list):
        report.fail("nodes is a list")
        nodes = []
    else:
        report.ok("nodes is a list")

    total_nodes = manifest.get("total_nodes")
    if total_nodes == len(nodes):
        report.ok("total_nodes matches len(nodes)")
    else:
        report.fail("total_nodes matches len(nodes)", f"total_nodes={total_nodes}, actual={len(nodes)}")

    mapbox = manifest.get("mapbox")
    center_valid = False
    zoom_valid = False
    if isinstance(mapbox, dict):
        center = mapbox.get("center")
        zoom = mapbox.get("zoom")
        if isinstance(center, dict) and is_number(center.get("lat")) and is_number(center.get("lng")):
            lat = float(center["lat"])
            lng = float(center["lng"])
            if lat != 0.0 and lng != 0.0:
                center_valid = True
        if is_number(zoom) and 1 <= float(zoom) <= 22:
            zoom_valid = True

    if center_valid:
        report.ok("mapbox.center.lat and lng are non-zero floats")
    else:
        report.fail("mapbox.center.lat and lng are non-zero floats")

    if zoom_valid:
        report.ok("mapbox.zoom is between 1 and 22")
    else:
        report.fail("mapbox.zoom is between 1 and 22")

    if manifest.get("projection") == "equirectangular":
        report.ok("projection == equirectangular")
    else:
        report.fail("projection == equirectangular", f"projection={manifest.get('projection')}")

    # ASSET root checks
    if TILES_DIR.exists() and any(TILES_DIR.iterdir()):
        report.ok("./tiles directory exists and is non-empty")
    else:
        report.fail("./tiles directory exists and is non-empty")

    node_ids: set[str] = set()
    duplicate_ids: set[str] = set()
    all_ids: set[str] = set()

    bbox_lats: list[float] = []
    bbox_lngs: list[float] = []

    # First pass gather IDs
    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_id = str(node.get("id", ""))
        if not node_id:
            continue
        if node_id in node_ids:
            duplicate_ids.add(node_id)
        node_ids.add(node_id)
        all_ids.add(node_id)

    if duplicate_ids:
        report.fail("id is unique across all nodes", ", ".join(sorted(duplicate_ids)))
    else:
        report.ok("id is unique across all nodes")

    # Per-node checks
    for index, node in enumerate(nodes, start=1):
        if not isinstance(node, dict):
            report.fail(f"Node #{index} is an object")
            continue

        node_id = str(node.get("id", f"unknown_{index}"))
        node_prefix = f"Node {node_id}"

        missing_keys = sorted(NODE_REQUIRED_KEYS - set(node.keys()))
        if missing_keys:
            report.fail(f"{node_prefix}: required keys present", ", ".join(missing_keys))
        else:
            report.ok(f"{node_prefix}: required keys present")

        gps = node.get("gps") if isinstance(node.get("gps"), dict) else {}
        lat = gps.get("lat")
        lng = gps.get("lng")
        alt = gps.get("alt")

        if is_number(lat) and -90 <= float(lat) <= 90:
            report.ok(f"{node_prefix}: gps.lat between -90 and 90")
            bbox_lats.append(float(lat))
        else:
            report.fail(f"{node_prefix}: gps.lat between -90 and 90", f"lat={lat}")

        if is_number(lng) and -180 <= float(lng) <= 180:
            report.ok(f"{node_prefix}: gps.lng between -180 and 180")
            bbox_lngs.append(float(lng))
        else:
            report.fail(f"{node_prefix}: gps.lng between -180 and 180", f"lng={lng}")

        if is_number(alt):
            report.ok(f"{node_prefix}: gps.alt is a number")
        else:
            report.fail(f"{node_prefix}: gps.alt is a number", f"alt={alt}")

        heading = node.get("heading")
        if is_number(heading) and 0 <= float(heading) <= 360:
            report.ok(f"{node_prefix}: heading between 0 and 360")
        else:
            report.fail(f"{node_prefix}: heading between 0 and 360", f"heading={heading}")

        node_type = node.get("type")
        if node_type in VALID_TYPES:
            report.ok(f"{node_prefix}: type in [merged, standalone]")
        elif isinstance(node_type, str) and node_type.strip():
            report.warn(f"{node_prefix}: type differs from expected node types", f"type={node_type}")
        else:
            report.fail(f"{node_prefix}: type in [merged, standalone]", f"type={node_type}")

        confidence = node.get("confidence")
        if confidence in VALID_CONFIDENCE:
            report.ok(f"{node_prefix}: confidence in [HIGH, MEDIUM, original]")
        elif isinstance(confidence, str) and confidence.strip():
            report.warn(
                f"{node_prefix}: confidence differs from expected values",
                f"confidence={confidence}",
            )
        else:
            report.fail(
                f"{node_prefix}: confidence in [HIGH, MEDIUM, original]",
                f"confidence={confidence}",
            )

        scene_folder = str(node.get("scene_folder", ""))
        scene_path = TILES_DIR / scene_folder
        if scene_folder and scene_path.exists() and scene_path.is_dir():
            report.ok(f"{node_prefix}: scene_folder exists in ./tiles")
        else:
            report.fail(f"{node_prefix}: scene_folder exists in ./tiles", scene_folder)

        if scene_folder and any_tile_exists(scene_folder):
            report.ok(f"{node_prefix}: at least one tile exists")
        else:
            report.fail(f"{node_prefix}: at least one tile exists", scene_folder)

        filename = str(node.get("filename", ""))
        found_asset, where = asset_exists(filename)
        if found_asset:
            report.ok(f"{node_prefix}: panorama asset exists")
        else:
            report.fail(
                f"{node_prefix}: panorama asset exists",
                f"checked Anh360/output_tour/panoramas for {filename}",
            )

        if scene_folder and preview_candidate_exists(scene_folder):
            report.ok(f"{node_prefix}: preview thumbnail candidate exists")
        else:
            report.fail(f"{node_prefix}: preview thumbnail candidate exists", scene_folder)

        # GPS sanity warning bounds
        if is_number(lat) and is_number(lng):
            lat_f = float(lat)
            lng_f = float(lng)
            if not (14.0 <= lat_f <= 14.2 and 108.2 <= lng_f <= 108.4):
                report.warn(
                    f"{node_prefix}: GPS is outside Kon Tum sanity box",
                    f"lat={lat_f}, lng={lng_f}",
                )

        hotspots = node.get("hotspots")
        if not isinstance(hotspots, list):
            report.fail(f"{node_prefix}: hotspots is a list")
            continue

        for hs_index, hotspot in enumerate(hotspots, start=1):
            if not isinstance(hotspot, dict):
                report.fail(f"{node_prefix}: hotspot #{hs_index} is an object")
                continue

            hs_prefix = f"{node_prefix} hotspot #{hs_index}"
            target_id = str(hotspot.get("target_id", ""))
            if target_id in all_ids:
                report.ok(f"{hs_prefix}: target_id exists as node id")
            else:
                report.fail(f"{hs_prefix}: target_id exists as node id", target_id)

            yaw = hotspot.get("yaw")
            if is_number(yaw) and 0 <= float(yaw) <= 360:
                report.ok(f"{hs_prefix}: yaw between 0 and 360")
            else:
                report.fail(f"{hs_prefix}: yaw between 0 and 360", f"yaw={yaw}")

            pitch = hotspot.get("pitch")
            if is_number(pitch) and -90 <= float(pitch) <= 0:
                report.ok(f"{hs_prefix}: pitch between -90 and 0")
            else:
                report.fail(f"{hs_prefix}: pitch between -90 and 0", f"pitch={pitch}")

            distance_m = hotspot.get("distance_m")
            if is_number(distance_m) and float(distance_m) > 0:
                report.ok(f"{hs_prefix}: distance_m > 0")
            else:
                report.fail(f"{hs_prefix}: distance_m > 0", f"distance_m={distance_m}")

            if target_id and target_id != node_id:
                report.ok(f"{hs_prefix}: not self-referencing")
            else:
                report.fail(f"{hs_prefix}: not self-referencing", target_id)

    if bbox_lats and bbox_lngs:
        min_lat = min(bbox_lats)
        max_lat = max(bbox_lats)
        min_lng = min(bbox_lngs)
        max_lng = max(bbox_lngs)
        report.ok(
            f"Computed bounding box lat[{min_lat:.6f}, {max_lat:.6f}] lng[{min_lng:.6f}, {max_lng:.6f}]"
        )
    else:
        report.warn("Could not compute bounding box due to missing valid GPS points")

    print(f"\nPASSED: {report.passed}  WARNINGS: {report.warnings}  FAILED: {report.failed}")
    if report.failed == 0:
        print("Manifest is VALID")
        return 0

    print("Manifest is INVALID")
    return 1


if __name__ == "__main__":
    sys.exit(main())
