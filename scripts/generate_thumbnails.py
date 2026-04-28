"""Ensure thumbnails exist and are correctly sized for all manifest nodes."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT_DIR / "tour_manifest.json"
PREVIEW_DIR = ROOT_DIR / "preview"
ENV_PATH = ROOT_DIR / ".env.local"

SOURCE_DIRS = [
    ROOT_DIR / "Anh360",
    ROOT_DIR / "panoramas",
    ROOT_DIR / "output_tour",
]

THUMB_SIZE = (512, 256)


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            values[key] = value

    return values


def load_manifest(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError("Manifest root must be an object")
    return payload


def find_source(filename: str) -> Path | None:
    for directory in SOURCE_DIRS:
        candidate = directory / filename
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def ensure_pillow():
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ModuleNotFoundError as exc:
        print("Pillow is required for thumbnail generation.")
        print(f"Install it with: {sys.executable} -m pip install Pillow")
        raise SystemExit(1) from exc
    return Image, ImageDraw, ImageFont


def infer_r2_base(manifest: dict[str, Any], env_values: dict[str, str]) -> str:
    base = env_values.get("VITE_R2_PUBLIC_URL", "").strip().rstrip("/")
    if base:
        return base

    nodes = manifest.get("nodes")
    if isinstance(nodes, list):
        for node in nodes:
            if not isinstance(node, dict):
                continue
            thumb = str(node.get("thumbnail", ""))
            marker = "/thumbnails/"
            if marker in thumb:
                return thumb.split(marker, 1)[0].rstrip("/")

    return "https://pub-CHANGEME.r2.dev"


def update_thumbnail_urls(manifest: dict[str, Any], r2_base: str) -> None:
    nodes = manifest.get("nodes")
    if not isinstance(nodes, list):
        return

    for node in nodes:
        if not isinstance(node, dict):
            continue
        scene_folder = str(node.get("scene_folder", "")).strip()
        if not scene_folder:
            continue
        node["thumbnail"] = f"{r2_base}/thumbnails/{scene_folder}_thumb.jpg"


def create_placeholder(image_cls, draw_cls, font_cls, path: Path, text: str) -> None:
    image = image_cls.new("RGB", THUMB_SIZE, color=(18, 24, 33))
    draw = draw_cls.Draw(image)
    font = font_cls.load_default()

    content = text.strip() or "Panorama"
    max_chars = 36
    if len(content) > max_chars:
        content = content[: max_chars - 3] + "..."

    bbox = draw.textbbox((0, 0), content, font=font)
    width = bbox[2] - bbox[0]
    height = bbox[3] - bbox[1]
    x = (THUMB_SIZE[0] - width) // 2
    y = (THUMB_SIZE[1] - height) // 2

    draw.text((x, y), content, fill=(220, 228, 240), font=font)
    image.save(path, format="JPEG", quality=85, optimize=True)


def main() -> int:
    Image, ImageDraw, ImageFont = ensure_pillow()

    if not MANIFEST_PATH.exists():
        print(f"Manifest not found: {MANIFEST_PATH.as_posix()}")
        return 1

    manifest = load_manifest(MANIFEST_PATH)
    nodes = manifest.get("nodes")
    if not isinstance(nodes, list):
        print("Invalid manifest: nodes must be a list")
        return 1

    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    exists_count = 0
    generated_count = 0
    placeholder_count = 0

    for node in nodes:
        if not isinstance(node, dict):
            continue

        scene_folder = str(node.get("scene_folder", "")).strip()
        filename = str(node.get("filename", "")).strip()
        node_name = str(node.get("name", "Panorama"))

        if not scene_folder:
            continue

        thumb_path = PREVIEW_DIR / f"{scene_folder}_thumb.jpg"

        valid_existing = False
        if thumb_path.exists():
            try:
                with Image.open(thumb_path) as image:
                    width, height = image.size
                    if width >= THUMB_SIZE[0] and height >= THUMB_SIZE[1]:
                        valid_existing = True
            except Exception:
                valid_existing = False

        if valid_existing:
            exists_count += 1
            print(f"✅ exists    — {thumb_path.name}")
            continue

        source = find_source(filename)
        if source is not None:
            try:
                with Image.open(source) as image:
                    resized = image.convert("RGB").resize(THUMB_SIZE, resample=Image.Resampling.LANCZOS)
                    resized.save(thumb_path, format="JPEG", quality=85, optimize=True)
                generated_count += 1
                print(f"🔨 generated — {thumb_path.name} (from {source.as_posix()})")
            except Exception as exc:  # noqa: BLE001 - continue with placeholder fallback
                create_placeholder(Image, ImageDraw, ImageFont, thumb_path, node_name)
                placeholder_count += 1
                print(f"⚠️  placeholder — {thumb_path.name} (source error: {exc})")
        else:
            create_placeholder(Image, ImageDraw, ImageFont, thumb_path, node_name)
            placeholder_count += 1
            print(f"⚠️  placeholder — {thumb_path.name} (no source found)")

    env_values = parse_env_file(ENV_PATH)
    r2_base = infer_r2_base(manifest, env_values)
    update_thumbnail_urls(manifest, r2_base)

    with MANIFEST_PATH.open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(
        f"Summary: {exists_count} exists, {generated_count} generated, {placeholder_count} placeholders"
    )
    print("Updated manifest thumbnail URLs for all nodes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
