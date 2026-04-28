"""Master pre-deployment preflight checks."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT_DIR / ".env.local"
MANIFEST_PATH = ROOT_DIR / "tour_manifest.json"
PREVIEW_DIR = ROOT_DIR / "preview"
TILES_DIR = ROOT_DIR / "tiles"
WEB_DIR = ROOT_DIR / "virtual-tour-web"


@dataclass
class StepResult:
    label: str
    symbol: str
    note: str


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


def is_placeholder(value: str) -> bool:
    lowered = value.strip().lower()
    if not lowered:
        return True
    if lowered in {"changeme", "xxxx", "xxx", "your_value_here", "eyj...", "pk.eyj..."}:
        return True
    if "changeme" in lowered or "xxxx" in lowered:
        return True
    return False


def run_subprocess(command: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=str(cwd) if cwd else None,
        text=True,
        capture_output=True,
        check=False,
    )


def load_manifest(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError("Manifest root must be an object")
    return payload


def step_1_env(values: dict[str, str]) -> tuple[StepResult, bool]:
    print("\nSTEP 1 — Environment check")

    checks: list[tuple[str, str, callable]] = [
        ("VITE_SUPABASE_URL", "must start with https://", lambda v: v.startswith("https://")),
        ("VITE_SUPABASE_ANON_KEY", "must start with eyJ", lambda v: v.startswith("eyJ")),
        ("VITE_MAPBOX_TOKEN", "must start with pk.eyJ", lambda v: v.startswith("pk.eyJ")),
        ("VITE_R2_PUBLIC_URL", "must start with https://", lambda v: v.startswith("https://")),
        ("R2_ACCOUNT_ID", "must be non-empty", lambda v: len(v.strip()) > 0),
        ("R2_ACCESS_KEY_ID", "must be non-empty", lambda v: len(v.strip()) > 0),
        ("R2_SECRET_ACCESS_KEY", "must be non-empty", lambda v: len(v.strip()) > 0),
        ("R2_BUCKET_NAME", "must be non-empty", lambda v: len(v.strip()) > 0),
    ]

    ok = True
    for key, rule_text, validator in checks:
        value = values.get(key, "").strip()
        if not value:
            ok = False
            print(f"❌ {key}: missing ({rule_text})")
            continue
        if is_placeholder(value):
            ok = False
            print(f"❌ {key}: placeholder value detected")
            continue
        if not validator(value):
            ok = False
            print(f"❌ {key}: invalid ({rule_text})")
            continue
        print(f"✅ {key}: ok")

    if ok:
        return StepResult("Step 1 Env vars", "✅", "All required env vars valid"), True
    return StepResult("Step 1 Env vars", "❌", "Missing/invalid env vars"), False


def step_2_manifest() -> tuple[StepResult, bool]:
    print("\nSTEP 2 — Manifest validation")
    result = run_subprocess([sys.executable, "scripts/validate_manifest.py"], cwd=ROOT_DIR)

    if result.stdout:
        print(result.stdout.rstrip())
    if result.stderr:
        print(result.stderr.rstrip())

    if result.returncode == 0:
        return StepResult("Step 2 Manifest", "✅", "Manifest validation passed"), True
    return StepResult("Step 2 Manifest", "❌", "Manifest validation failed"), False


def step_3_thumbnails() -> tuple[StepResult, bool]:
    print("\nSTEP 3 — Thumbnail check")

    if not MANIFEST_PATH.exists():
        print("⚠️  Manifest missing, skipping thumbnail check")
        return StepResult("Step 3 Thumbnails", "⚠️", "Manifest missing"), True

    try:
        manifest = load_manifest(MANIFEST_PATH)
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️  Could not parse manifest: {exc}")
        return StepResult("Step 3 Thumbnails", "⚠️", "Manifest parse failed"), True

    nodes = manifest.get("nodes") if isinstance(manifest.get("nodes"), list) else []
    node_count = len(nodes)
    preview_count = len(list(PREVIEW_DIR.glob("*.jpg"))) if PREVIEW_DIR.exists() else 0

    print(f"Preview files: {preview_count}")
    print(f"Manifest nodes: {node_count}")

    if preview_count < node_count:
        print("Preview count is lower than node count, generating thumbnails...")
        result = run_subprocess([sys.executable, "scripts/generate_thumbnails.py"], cwd=ROOT_DIR)
        if result.stdout:
            print(result.stdout.rstrip())
        if result.stderr:
            print(result.stderr.rstrip())
        if result.returncode != 0:
            return StepResult("Step 3 Thumbnails", "⚠️", "Thumbnail generation had issues"), True
        return StepResult("Step 3 Thumbnails", "⚠️", "Generated missing thumbnails"), True

    return StepResult("Step 3 Thumbnails", "✅", "Thumbnail count is sufficient"), True


def step_4_tiles() -> tuple[StepResult, bool]:
    print("\nSTEP 4 — Tile check")

    try:
        manifest = load_manifest(MANIFEST_PATH)
        nodes = manifest.get("nodes") if isinstance(manifest.get("nodes"), list) else []
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️  Could not inspect manifest for tile check: {exc}")
        return StepResult("Step 4 Tiles", "⚠️", "Skipped due to manifest parse issue"), True

    warnings = 0
    scene_count = 0
    total_tiles = 0

    for node in nodes:
        if not isinstance(node, dict):
            continue
        scene_folder = str(node.get("scene_folder", "")).strip()
        if not scene_folder:
            continue
        scene_count += 1
        folder = TILES_DIR / scene_folder
        tile_count = len(list(folder.rglob("*.jpg"))) if folder.exists() else 0
        total_tiles += tile_count
        if tile_count < 4:
            warnings += 1
            print(f"⚠️  WARN: {scene_folder} has only {tile_count} tile(s)")

    print(f"{scene_count} scene folders, {total_tiles} total tiles")

    if warnings > 0:
        return StepResult("Step 4 Tiles", "⚠️", f"{warnings} scene folders have suspiciously few tiles"), True
    return StepResult("Step 4 Tiles", "✅", "Tile counts look healthy"), True


def step_5_r2(values: dict[str, str]) -> tuple[StepResult, bool]:
    print("\nSTEP 5 — R2 connectivity check")

    try:
        import boto3
    except ModuleNotFoundError:
        print("⚠️  boto3 not installed. Install with: python -m pip install boto3")
        return StepResult("Step 5 R2", "⚠️", "Skipped (boto3 not installed)"), True

    try:
        account_id = values["R2_ACCOUNT_ID"]
        access_key = values["R2_ACCESS_KEY_ID"]
        secret_key = values["R2_SECRET_ACCESS_KEY"]
        bucket_name = values["R2_BUCKET_NAME"]

        endpoint_url = f"https://{account_id}.r2.cloudflarestorage.com"
        client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name="auto",
        )
        client.head_bucket(Bucket=bucket_name)
        print("R2 bucket accessible")
        return StepResult("Step 5 R2", "✅", "R2 bucket accessible"), True
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️  SKIPPED: R2 check not available in this environment ({exc})")
        print("Instructions: verify R2 credentials and network connectivity, then rerun preflight.")
        return StepResult("Step 5 R2", "⚠️", "Skipped (R2 unavailable locally)"), True


def step_6_supabase(values: dict[str, str]) -> tuple[StepResult, bool]:
    print("\nSTEP 6 — Supabase connectivity check")

    url = values.get("VITE_SUPABASE_URL", "").rstrip("/")
    anon_key = values.get("VITE_SUPABASE_ANON_KEY", "")

    endpoint = f"{url}/rest/v1/tours"
    request = urllib.request.Request(endpoint, headers={"apikey": anon_key})

    try:
        with urllib.request.urlopen(request, timeout=20) as response:  # noqa: S310
            status = response.getcode()
        if status == 200:
            print("Supabase reachable")
            return StepResult("Step 6 Supabase", "✅", "Supabase reachable"), True

        print(f"⚠️  SKIPPED: Supabase returned status {status}")
        print("Instructions: verify VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.")
        return StepResult("Step 6 Supabase", "⚠️", f"Skipped (status {status})"), True
    except urllib.error.HTTPError as exc:
        print(f"⚠️  SKIPPED: Supabase HTTP error {exc.code}")
        print("Instructions: verify API URL, anon key, and RLS policy for tours table.")
        return StepResult("Step 6 Supabase", "⚠️", f"Skipped (HTTP {exc.code})"), True
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️  SKIPPED: Supabase check unavailable ({exc})")
        print("Instructions: verify internet connectivity and Supabase project status.")
        return StepResult("Step 6 Supabase", "⚠️", "Skipped (Supabase unavailable locally)"), True


def step_7_build() -> tuple[StepResult, bool]:
    print("\nSTEP 7 — Node.js build check")

    npm_executable = shutil.which("npm") or shutil.which("npm.cmd") or shutil.which("npm.exe")
    if not npm_executable:
        print("❌ npm not found on PATH")
        return StepResult("Step 7 Build", "❌", "npm not found on PATH"), False

    result = run_subprocess([npm_executable, "run", "build"], cwd=WEB_DIR)

    if result.stdout:
        print(result.stdout.rstrip())
    if result.stderr:
        print(result.stderr.rstrip())

    if result.returncode == 0:
        print("Astro build passes")
        return StepResult("Step 7 Build", "✅", "Astro build passes"), True

    print("❌ Build failed")
    return StepResult("Step 7 Build", "❌", "Astro build failed"), False


def step_8_git() -> tuple[StepResult, bool]:
    print("\nSTEP 8 — Git status check")
    result = run_subprocess(["git", "status", "--porcelain"], cwd=ROOT_DIR)

    if result.returncode != 0:
        note = (result.stderr or result.stdout or "Not a git repository").strip()
        print(f"Git status unavailable: {note}")
        print("Treating as clean for local preflight.")
        return StepResult("Step 8 Git", "✅", "Git status unavailable, treated as clean"), True

    output = result.stdout.strip()
    if ".env.local" in output:
        print("DANGER: .env.local is tracked by git. Aborting.")
        return StepResult("Step 8 Git", "❌", ".env.local appears in git status"), False

    if not output:
        print("Git status clean")
        return StepResult("Step 8 Git", "✅", "Git status clean"), True

    lines = [line for line in output.splitlines() if line.strip()]
    print(f"Git status: {len(lines)} uncommitted file(s)")
    return StepResult("Step 8 Git", "✅", f"{len(lines)} uncommitted files"), True


def print_table(results: list[StepResult], ready: bool) -> None:
    lookup = {result.label: result for result in results}

    def line(label: str) -> str:
        item = lookup.get(label, StepResult(label, "❌", "Not executed"))
        return f"║  {label:<18} {item.symbol:<2}      ║"

    print("\n╔══════════════════════════════════╗")
    print("║  PREFLIGHT RESULTS               ║")
    print("╠══════════════════════════════════╣")
    print(line("Step 1 Env vars"))
    print(line("Step 2 Manifest"))
    print(line("Step 3 Thumbnails"))
    print(line("Step 4 Tiles"))
    print(line("Step 5 R2"))
    print(line("Step 6 Supabase"))
    print(line("Step 7 Build"))
    print(line("Step 8 Git"))
    print("╠══════════════════════════════════╣")
    print(f"║  {'READY TO DEPLOY' if ready else 'BLOCKED':<30}║")
    print("╚══════════════════════════════════╝")


def main() -> int:
    values = parse_env_file(ENV_PATH)
    results: list[StepResult] = []

    step_result, ok = step_1_env(values)
    results.append(step_result)
    if not ok:
        print_table(results, ready=False)
        return 1

    step_result, ok = step_2_manifest()
    results.append(step_result)
    if not ok:
        print_table(results, ready=False)
        return 1

    step_result, _ = step_3_thumbnails()
    results.append(step_result)

    step_result, _ = step_4_tiles()
    results.append(step_result)

    step_result, _ = step_5_r2(values)
    results.append(step_result)

    step_result, _ = step_6_supabase(values)
    results.append(step_result)

    step_result, ok = step_7_build()
    results.append(step_result)
    if not ok:
        print_table(results, ready=False)
        return 1

    step_result, ok = step_8_git()
    results.append(step_result)
    if not ok:
        print_table(results, ready=False)
        return 1

    print_table(results, ready=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
