"""Transform panorama metadata into tour_manifest.json.

This script reads the current workspace metadata, resolves scene folders from
existing tiles and previews, computes node headings and hotspot links, then
writes the manifest used by the web app.
"""

from __future__ import annotations

import json
import math
import os
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]
PRIMARY_METADATA = ROOT_DIR / "panorama_metadata.json"
FALLBACK_METADATA = ROOT_DIR / "Anh360" / "panorama_metadata.json"
TILES_DIR = ROOT_DIR / "tiles"
PREVIEW_DIR = ROOT_DIR / "preview"
OUTPUT_MANIFEST = ROOT_DIR / "tour_manifest.json"
R2_BASE_URL = os.environ.get("VITE_R2_PUBLIC_URL", "https://pub-CHANGEME.r2.dev").rstrip("/")

HOTSPOT_MAX_DISTANCE_M = 500.0


def read_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as file_handle:
        return json.load(file_handle)


def normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    ascii_text = ascii_text.lower()
    ascii_text = re.sub(r"[^a-z0-9]+", "_", ascii_text)
    return ascii_text.strip("_")


def slugify(name: str) -> str:
    return normalize_text(name) or "node"


def haversine_distance(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius_m = 6_371_000.0
    rlat1 = math.radians(lat1)
    rlat2 = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlng / 2) ** 2
    )
    return radius_m * 2 * math.asin(math.sqrt(a))


def bearing(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    rlat1 = math.radians(lat1)
    rlat2 = math.radians(lat2)
    dlng = math.radians(lng2 - lng1)
    x = math.sin(dlng) * math.cos(rlat2)
    y = (
        math.cos(rlat1) * math.sin(rlat2)
        - math.sin(rlat1) * math.cos(rlat2) * math.cos(dlng)
    )
    return (math.degrees(math.atan2(x, y)) + 360.0) % 360.0


def coerce_images(raw: Any) -> list[dict[str, Any]]:
    if isinstance(raw, list):
        return [item for item in raw if isinstance(item, dict)]
    if isinstance(raw, dict):
        images = raw.get("images")
        if isinstance(images, list):
            return [item for item in images if isinstance(item, dict)]
    return []


def load_metadata_sources() -> list[dict[str, Any]]:
    candidates = [PRIMARY_METADATA, FALLBACK_METADATA]
    records: list[dict[str, Any]] = []
    seen: set[str] = set()

    for path in candidates:
        if not path.exists():
            continue

        raw = read_json(path)
        for image in coerce_images(raw):
            file_name = str(image.get("filename") or image.get("id") or "").strip()
            key = normalize_text(file_name) or normalize_text(str(image.get("id") or ""))
            if not key or key in seen:
                continue
            seen.add(key)
            records.append(image)

    if not records:
        raise FileNotFoundError(
            "No usable metadata found in panorama_metadata.json or Anh360/panorama_metadata.json"
        )

    return records


def scene_folders() -> list[Path]:
    if not TILES_DIR.exists():
        return []
    return sorted([path for path in TILES_DIR.iterdir() if path.is_dir()], key=lambda p: p.name)


def resolve_scene_folder(index: int, image: dict[str, Any], folders: list[Path]) -> str:
    candidates: list[str] = [f"scene_{index + 1:02d}"]

    filename = str(image.get("filename") or image.get("id") or "")
    stem = Path(filename).stem
    if stem:
        candidates.append(slugify(stem))

    image_id = str(image.get("id") or "")
    if image_id:
        candidates.append(slugify(image_id))

    name = str(image.get("name") or image.get("location_name") or "")
    if name:
        candidates.append(slugify(name))

    folder_names = {folder.name for folder in folders}
    for candidate in candidates:
        if candidate in folder_names:
            return candidate

    return f"scene_{index + 1:02d}"


def detect_tile_format(scene_folder: str) -> dict[str, Any]:
    folder = TILES_DIR / scene_folder
    if not folder.exists():
        return {"format": "missing", "rows": 0, "cols": 0}

    level_dirs = [path for path in folder.iterdir() if path.is_dir() and path.name.isdigit()]
    if level_dirs:
        level_dir = max(level_dirs, key=lambda path: int(path.name))
        col_dirs = sorted(
            [path for path in level_dir.iterdir() if path.is_dir() and path.name.isdigit()],
            key=lambda path: int(path.name),
        )
        if col_dirs:
            rows = max((len(list(col_dir.glob("*.jpg"))) for col_dir in col_dirs), default=0)
            return {"format": "marzipano_standard", "rows": rows, "cols": len(col_dirs)}

    tiles = sorted(folder.glob("tile_*.jpg"))
    if tiles:
        rows = 0
        cols = 0
        for tile in tiles:
            parts = tile.stem.split("_")
            if len(parts) < 3:
                continue
            try:
                row_index = int(parts[1])
                col_index = int(parts[2])
            except ValueError:
                continue
            rows = max(rows, row_index + 1)
            cols = max(cols, col_index + 1)
        return {"format": "flat_row_col", "rows": rows, "cols": cols}

    return {"format": "unknown", "rows": 0, "cols": 0}


def get_gps(image: dict[str, Any]) -> tuple[float, float, float]:
    spatial = image.get("spatial") if isinstance(image.get("spatial"), dict) else None
    gps = spatial.get("gps") if isinstance(spatial, dict) else None
    if gps is None:
        gps = image.get("gps")

    if not isinstance(gps, dict):
        return 0.0, 0.0, 0.0

    lat = gps.get("lat", gps.get("latitude", 0.0))
    lng = gps.get("lng", gps.get("longitude", 0.0))
    alt = gps.get("altitude", gps.get("alt", 0.0))
    return float(lat or 0.0), float(lng or 0.0), float(alt or 0.0)


def get_timestamp(image: dict[str, Any]) -> str | None:
    temporal = image.get("temporal")
    if isinstance(temporal, dict):
        timestamp = temporal.get("timestamp")
        if timestamp:
            return str(timestamp)
    value = image.get("timestamp")
    return str(value) if value else None


def get_name(image: dict[str, Any], fallback: str) -> str:
    name = image.get("name") or image.get("location_name") or image.get("id") or Path(fallback).stem
    return str(name)


def get_filename(image: dict[str, Any], fallback: str) -> str:
    filename = image.get("filename") or image.get("file_name") or fallback
    return str(filename)


def thumbnail_url(scene_folder: str) -> str:
    return f"{R2_BASE_URL}/thumbnails/{scene_folder}_thumb.jpg"


def tile_url_pattern(scene_folder: str, tile_format: str) -> str:
    base = f"{R2_BASE_URL}/tiles/{scene_folder}"
    if tile_format == "marzipano_standard":
        return f"{base}/{{z}}/{{x}}/{{y}}.jpg"
    return f"{base}/tile_{{y}}_{{x}}.jpg"


def build_nodes(images: list[dict[str, Any]]) -> list[dict[str, Any]]:
    folders = scene_folders()
    nodes: list[dict[str, Any]] = []

    for index, image in enumerate(images):
        scene_folder = resolve_scene_folder(index, image, folders)
        tile_info = detect_tile_format(scene_folder)
        filename = get_filename(image, f"{scene_folder}.JPG")
        name = get_name(image, filename)
        gps_lat, gps_lng, gps_alt = get_gps(image)
        timestamp = get_timestamp(image)
        image_type = image.get("image_type") or image.get("type") or "standalone"
        confidence = image.get("quality_score") or image.get("quality") or "original"

        node: dict[str, Any] = {
            "id": f"node_{index + 1:02d}_{slugify(name)}",
            "scene_folder": scene_folder,
            "name": name,
            "filename": filename,
            "url": f"{R2_BASE_URL}/panoramas/{filename}",
            "thumbnail": thumbnail_url(scene_folder),
            "tiles_url": f"{R2_BASE_URL}/tiles/{scene_folder}",
            "tile_url_pattern": tile_url_pattern(scene_folder, str(tile_info["format"])),
            "tile_format": tile_info["format"],
            "tile_info": {
                "format": tile_info["format"],
                "rows": tile_info["rows"],
                "cols": tile_info["cols"],
            },
            "gps": {
                "lat": round(gps_lat, 8),
                "lng": round(gps_lng, 8),
                "alt": round(gps_alt, 2),
            },
            "heading": 0.0,
            "type": image_type,
            "confidence": confidence,
            "hotspots": [],
        }
        if timestamp:
            node["timestamp"] = timestamp
        nodes.append(node)

    for index, node in enumerate(nodes):
        if not (node["gps"]["lat"] and node["gps"]["lng"]):
            continue

        nearest_node: dict[str, Any] | None = None
        nearest_distance = float("inf")
        for other_index, other in enumerate(nodes):
            if index == other_index:
                continue
            if not (other["gps"]["lat"] and other["gps"]["lng"]):
                continue
            distance = haversine_distance(
                node["gps"]["lat"],
                node["gps"]["lng"],
                other["gps"]["lat"],
                other["gps"]["lng"],
            )
            if distance < nearest_distance:
                nearest_distance = distance
                nearest_node = other

        if nearest_node is not None:
            node["heading"] = round(
                bearing(
                    node["gps"]["lat"],
                    node["gps"]["lng"],
                    nearest_node["gps"]["lat"],
                    nearest_node["gps"]["lng"],
                ),
                2,
            )

    for source_index, source in enumerate(nodes):
        if not (source["gps"]["lat"] and source["gps"]["lng"]):
            continue

        for target_index, target in enumerate(nodes):
            if source_index == target_index:
                continue
            if not (target["gps"]["lat"] and target["gps"]["lng"]):
                continue

            distance_m = haversine_distance(
                source["gps"]["lat"],
                source["gps"]["lng"],
                target["gps"]["lat"],
                target["gps"]["lng"],
            )
            if distance_m > HOTSPOT_MAX_DISTANCE_M:
                continue

            absolute_bearing = bearing(
                source["gps"]["lat"],
                source["gps"]["lng"],
                target["gps"]["lat"],
                target["gps"]["lng"],
            )
            relative_yaw = (absolute_bearing - source["heading"] + 360.0) % 360.0
            source["hotspots"].append(
                {
                    "target_id": target["id"],
                    "target_name": target["name"],
                    "yaw": round(relative_yaw, 2),
                    "pitch": -10.0,
                    "distance_m": round(distance_m, 1),
                    "label": f"→ {target['name']}",
                }
            )

    return nodes


def build_manifest(nodes: list[dict[str, Any]]) -> dict[str, Any]:
    valid_nodes = [node for node in nodes if node["gps"]["lat"] and node["gps"]["lng"]]
    center_lat = sum(node["gps"]["lat"] for node in valid_nodes) / len(valid_nodes)
    center_lng = sum(node["gps"]["lng"] for node in valid_nodes) / len(valid_nodes)

    return {
        "tour_name": "Virtual Tour — Rừng Phòng Hộ Kon Tum",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "camera": "DJI M3E",
        "projection": "equirectangular",
        "resolution": "14400x7200",
        "total_nodes": len(nodes),
        "tile_format": nodes[0]["tile_format"] if nodes else "unknown",
        "mapbox": {
            "center": {
                "lat": round(center_lat, 6),
                "lng": round(center_lng, 6),
            },
            "zoom": 14,
            "pitch": 45,
            "style": "mapbox://styles/mapbox/satellite-streets-v12",
        },
        "nodes": nodes,
    }


def transform() -> dict[str, Any]:
    images = load_metadata_sources()
    nodes = build_nodes(images)
    manifest = build_manifest(nodes)
    with OUTPUT_MANIFEST.open("w", encoding="utf-8") as file_handle:
        json.dump(manifest, file_handle, ensure_ascii=False, indent=2)

    total_hotspots = sum(len(node["hotspots"]) for node in nodes)
    gps_count = len([node for node in nodes if node["gps"]["lat"] and node["gps"]["lng"]])
    gps_coverage = round((gps_count / len(nodes)) * 100.0, 2) if nodes else 0.0

    print(f"Total nodes: {len(nodes)}")
    print(f"GPS coverage: {gps_coverage}%")
    print(f"Hotspots: {total_hotspots}")
    print(f"Tile format detected: {manifest['tile_format']}")
    print(f"Output path: {OUTPUT_MANIFEST}")
    return manifest


if __name__ == "__main__":
    transform()
