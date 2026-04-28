"""Reorganize flat tiles into Marzipano multi-level tile folders.

Usage:
  python scripts/reorganize_tiles.py --dry-run
  python scripts/reorganize_tiles.py
  python scripts/reorganize_tiles.py --scene scene_01
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT_DIR / "tour_manifest.json"
TILES_DIR = ROOT_DIR / "tiles"
TILE_SIZE = 256
FLAT_TILE_PATTERN = re.compile(r"^tile_(\d+)_(\d+)\.jpg$", re.IGNORECASE)


@dataclass(frozen=True)
class SceneStats:
    scene_folder: str
    source_rows: int
    source_cols: int
    full_width: int
    full_height: int
    levels: list[dict[str, int]]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert flat row/col tiles into Marzipano multi-level tiles.")
    parser.add_argument("--dry-run", action="store_true", help="Print planned changes without writing files.")
    parser.add_argument("--scene", help="Process only one scene folder (example: scene_01).")
    return parser.parse_args()


def load_manifest(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Manifest not found: {path}")
    with path.open(encoding="utf-8") as file_handle:
        payload = json.load(file_handle)
    if not isinstance(payload, dict):
        raise ValueError("Invalid manifest format")
    if not isinstance(payload.get("nodes"), list):
        raise ValueError("Manifest does not contain nodes[]")
    return payload


def import_pillow() -> Any:
    try:
        from PIL import Image  # type: ignore
        return Image
    except ModuleNotFoundError as error:
        print("Pillow is required for tile reorganization.")
        print(f"Install it with: {sys.executable} -m pip install Pillow")
        raise SystemExit(1) from error


def discover_scene_folders(manifest: dict[str, Any], only_scene: str | None) -> list[str]:
    scenes: list[str] = []
    for node in manifest["nodes"]:
        scene_folder = str(node.get("scene_folder") or "").strip()
        if not scene_folder:
            continue
        if only_scene and scene_folder != only_scene:
            continue
        if scene_folder not in scenes:
            scenes.append(scene_folder)
    return scenes


def load_flat_tiles(scene_path: Path) -> tuple[dict[tuple[int, int], Path], int, int]:
    tiles: dict[tuple[int, int], Path] = {}
    max_row = -1
    max_col = -1

    for file_path in scene_path.iterdir():
        if not file_path.is_file():
            continue
        match = FLAT_TILE_PATTERN.match(file_path.name)
        if not match:
            continue
        row_index = int(match.group(1))
        col_index = int(match.group(2))
        tiles[(row_index, col_index)] = file_path
        max_row = max(max_row, row_index)
        max_col = max(max_col, col_index)

    return tiles, max_row + 1, max_col + 1


def stitch_flat_tiles(image_module: Any, flat_tiles: dict[tuple[int, int], Path], rows: int, cols: int) -> Any:
    full_image = image_module.new("RGB", (cols * TILE_SIZE, rows * TILE_SIZE), color=(0, 0, 0))
    for (row_index, col_index), file_path in flat_tiles.items():
        with image_module.open(file_path) as tile:
            full_image.paste(tile.convert("RGB"), (col_index * TILE_SIZE, row_index * TILE_SIZE))
    return full_image


def build_level_specs(full_width: int, full_height: int) -> list[tuple[int, int, int]]:
    return [
        (0, 256, 128),
        (1, 512, 256),
        (2, 1024, 512),
        (3, full_width, full_height),
    ]


def tile_and_write_level(image_module: Any, source_image: Any, scene_path: Path, level: int, width: int, height: int, dry_run: bool) -> dict[str, int]:
    if level == 3:
        level_image = source_image.copy()
    else:
        level_image = source_image.resize((width, height), image_module.Resampling.LANCZOS)

    cols = math.ceil(level_image.width / TILE_SIZE)
    rows = math.ceil(level_image.height / TILE_SIZE)
    level_dir = scene_path / str(level)

    for col_index in range(cols):
        for row_index in range(rows):
            tile_box = (
                col_index * TILE_SIZE,
                row_index * TILE_SIZE,
                min((col_index + 1) * TILE_SIZE, level_image.width),
                min((row_index + 1) * TILE_SIZE, level_image.height),
            )
            tile = level_image.crop(tile_box)
            if tile.width != TILE_SIZE or tile.height != TILE_SIZE:
                canvas = image_module.new("RGB", (TILE_SIZE, TILE_SIZE), color=(0, 0, 0))
                canvas.paste(tile, (0, 0))
                tile = canvas

            out_path = level_dir / str(col_index) / f"{row_index}.jpg"
            if dry_run:
                continue
            out_path.parent.mkdir(parents=True, exist_ok=True)
            tile.save(out_path, format="JPEG", quality=85, optimize=True)

    return {
        "level": level,
        "width": level_image.width,
        "height": level_image.height,
        "cols": cols,
        "rows": rows,
        "tile_size": TILE_SIZE,
    }


def remove_existing_level_dirs(scene_path: Path, dry_run: bool) -> None:
    for child in scene_path.iterdir():
        if not child.is_dir() or not child.name.isdigit():
            continue
        if dry_run:
            continue
        for nested in sorted(child.rglob("*"), reverse=True):
            if nested.is_file():
                nested.unlink(missing_ok=True)
            elif nested.is_dir():
                nested.rmdir()
        child.rmdir()


def remove_flat_tiles(scene_path: Path, dry_run: bool) -> None:
    for child in scene_path.iterdir():
        if not child.is_file():
            continue
        if not FLAT_TILE_PATTERN.match(child.name):
            continue
        if dry_run:
            continue
        child.unlink(missing_ok=True)


def scene_r2_base_url(node: dict[str, Any]) -> str:
    tiles_url = str(node.get("tiles_url") or "")
    if "/tiles/" in tiles_url:
        return tiles_url.split("/tiles/", 1)[0].rstrip("/")
    pattern = str(node.get("tile_url_pattern") or "")
    if "/tiles/" in pattern:
        return pattern.split("/tiles/", 1)[0].rstrip("/")
    return "https://pub-CHANGEME.r2.dev"


def update_manifest_for_scene(manifest: dict[str, Any], stats: SceneStats) -> None:
    for node in manifest["nodes"]:
        if str(node.get("scene_folder")) != stats.scene_folder:
            continue
        base_url = scene_r2_base_url(node)
        node["tile_format"] = "marzipano_standard"
        node["tile_url_pattern"] = f"{base_url}/tiles/{stats.scene_folder}/{{z}}/{{x}}/{{y}}.jpg"
        node["tile_info"] = {
            "format": "marzipano_standard",
            "rows": stats.levels[-1]["rows"],
            "cols": stats.levels[-1]["cols"],
            "levels": stats.levels,
        }
        node["tile_levels"] = stats.levels


def save_manifest(manifest: dict[str, Any], dry_run: bool) -> None:
    if dry_run:
        return
    manifest["tile_format"] = "marzipano_standard"
    with MANIFEST_PATH.open("w", encoding="utf-8") as file_handle:
        json.dump(manifest, file_handle, ensure_ascii=False, indent=2)


def process_scene(image_module: Any, scene_folder: str, dry_run: bool) -> SceneStats | None:
    scene_path = TILES_DIR / scene_folder
    if not scene_path.exists():
        print(f"[skip] {scene_folder}: tile folder not found")
        return None

    flat_tiles, rows, cols = load_flat_tiles(scene_path)
    if not flat_tiles:
        print(f"[skip] {scene_folder}: no flat tile_{{row}}_{{col}}.jpg files found")
        return None

    print(f"[scene] {scene_folder}: {len(flat_tiles)} flat tiles ({rows} rows x {cols} cols)")
    full_image = stitch_flat_tiles(image_module, flat_tiles, rows, cols)

    remove_existing_level_dirs(scene_path, dry_run)
    level_specs = build_level_specs(full_image.width, full_image.height)
    level_stats: list[dict[str, int]] = []
    for level, width, height in level_specs:
        print(f"  - level {level}: {width}x{height}")
        stats = tile_and_write_level(image_module, full_image, scene_path, level, width, height, dry_run)
        level_stats.append(stats)

    remove_flat_tiles(scene_path, dry_run)

    return SceneStats(
        scene_folder=scene_folder,
        source_rows=rows,
        source_cols=cols,
        full_width=full_image.width,
        full_height=full_image.height,
        levels=level_stats,
    )


def main() -> None:
    args = parse_args()
    manifest = load_manifest(MANIFEST_PATH)
    scenes = discover_scene_folders(manifest, args.scene)
    if not scenes:
        print("No scene folders to process from manifest.")
        return

    image_module = import_pillow()

    processed: list[SceneStats] = []
    for scene_folder in scenes:
        stats = process_scene(image_module, scene_folder, args.dry_run)
        if stats is None:
            continue
        processed.append(stats)
        update_manifest_for_scene(manifest, stats)

    if processed:
        save_manifest(manifest, args.dry_run)

    print()
    print(f"Processed scenes: {len(processed)}")
    print(f"Dry run: {'yes' if args.dry_run else 'no'}")
    if args.scene:
        print(f"Scene filter: {args.scene}")
    if not args.dry_run and processed:
        print(f"Manifest updated: {MANIFEST_PATH}")


if __name__ == "__main__":
    main()