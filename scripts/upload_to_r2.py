"""Upload panorama assets and manifest to Cloudflare R2.

The script reads .env.local manually, uploads panoramas, tiles, thumbnails,
and the generated manifest using boto3, and skips files that already exist
unless --force is provided.
"""

from __future__ import annotations

import argparse
import mimetypes
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT_DIR / ".env.local"
PANORAMAS_DIR = ROOT_DIR / "Anh360"
TILES_DIR = ROOT_DIR / "tiles"
PREVIEW_DIR = ROOT_DIR / "preview"
MANIFEST_PATH = ROOT_DIR / "tour_manifest.json"


@dataclass(frozen=True)
class UploadItem:
    path: Path
    key: str
    content_type: str
    cache_control: str


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


def require_env(values: dict[str, str], key: str) -> str:
    value = values.get(key, "").strip()
    if not value:
        raise KeyError(key)
    return value


def detect_content_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suffix == ".json":
        return "application/json"
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def detect_cache_control(key: str) -> str:
    if key.startswith("panoramas/"):
        return "public, max-age=31536000"
    if key.startswith("tiles/"):
        return "public, max-age=31536000"
    if key.startswith("thumbnails/"):
        return "public, max-age=86400"
    if key.startswith("manifest/"):
        return "public, max-age=300"
    return "public, max-age=86400"


def collect_uploads() -> list[UploadItem]:
    items: list[UploadItem] = []

    if PANORAMAS_DIR.exists():
        for path in sorted(PANORAMAS_DIR.glob("*.JPG")):
            key = f"panoramas/{path.name}"
            items.append(
                UploadItem(
                    path=path,
                    key=key,
                    content_type=detect_content_type(path),
                    cache_control=detect_cache_control(key),
                )
            )

    if TILES_DIR.exists():
        for path in sorted(TILES_DIR.rglob("*.jpg")):
            key = f"tiles/{path.relative_to(TILES_DIR).as_posix()}"
            items.append(
                UploadItem(
                    path=path,
                    key=key,
                    content_type=detect_content_type(path),
                    cache_control=detect_cache_control(key),
                )
            )

    if PREVIEW_DIR.exists():
        for path in sorted(PREVIEW_DIR.glob("*.jpg")):
            key = f"thumbnails/{path.name}"
            items.append(
                UploadItem(
                    path=path,
                    key=key,
                    content_type=detect_content_type(path),
                    cache_control=detect_cache_control(key),
                )
            )

    if MANIFEST_PATH.exists():
        key = "manifest/tour_manifest.json"
        items.append(
            UploadItem(
                path=MANIFEST_PATH,
                key=key,
                content_type="application/json",
                cache_control=detect_cache_control(key),
            )
        )

    return items


def build_client(values: dict[str, str]):
    try:
        import boto3
    except ModuleNotFoundError as exc:
        print("boto3 is required for this script.")
        print(f"Install it with: {sys.executable} -m pip install boto3")
        raise SystemExit(1) from exc

    account_id = require_env(values, "R2_ACCOUNT_ID")
    access_key = require_env(values, "R2_ACCESS_KEY_ID")
    secret_key = require_env(values, "R2_SECRET_ACCESS_KEY")
    bucket_name = require_env(values, "R2_BUCKET_NAME")

    client = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
    )
    return client, bucket_name


def should_skip(client, bucket: str, key: str) -> bool:
    try:
        client.head_object(Bucket=bucket, Key=key)
        return True
    except Exception:
        return False


def upload_files(items: list[UploadItem], bucket: str, client, force: bool) -> None:
    uploaded = 0
    skipped = 0
    failed = 0
    total = len(items)

    for index, item in enumerate(items, start=1):
        print(f"Uploading [{index}/{total}] {item.path.as_posix()}...")
        try:
            if not force and should_skip(client, bucket, item.key):
                skipped += 1
                continue

            client.upload_file(
                str(item.path),
                bucket,
                item.key,
                ExtraArgs={
                    "ContentType": item.content_type,
                    "CacheControl": item.cache_control,
                },
            )
            uploaded += 1
        except Exception as exc:  # noqa: BLE001 - CLI needs to report all failures
            failed += 1
            print(f"  Failed: {exc}")

    print()
    print(f"Uploaded: {uploaded}")
    print(f"Skipped: {skipped}")
    print(f"Failed: {failed}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Upload tour assets to Cloudflare R2.")
    parser.add_argument("--force", action="store_true", help="Upload files even if they already exist.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    values = parse_env_file(ENV_PATH)
    client, bucket_name = build_client(values)
    items = collect_uploads()
    if not items:
        print("No files found to upload.")
        return
    upload_files(items, bucket_name, client, args.force)


if __name__ == "__main__":
    main()
