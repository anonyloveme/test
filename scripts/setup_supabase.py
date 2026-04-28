"""Automate Supabase initialization for the virtual tour project."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT_DIR / ".env.local"
MIGRATION_PATH = ROOT_DIR / "supabase" / "migrations" / "001_initial_schema.sql"
MANIFEST_PATH = ROOT_DIR / "tour_manifest.json"
TOUR_SLUG = "kon-tum-forest"


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        raise FileNotFoundError(f"Missing env file: {path}")
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
        raise KeyError(f"Missing required environment variable: {key}")
    return value


def http_request(
    url: str,
    method: str,
    headers: dict[str, str],
    body: Any = None,
) -> tuple[int, dict[str, str], Any]:
    encoded_body: bytes | None = None
    if body is not None:
        encoded_body = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url=url, method=method, headers=headers, data=encoded_body)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
            payload = json.loads(raw) if raw.strip() else None
            return resp.status, dict(resp.headers.items()), payload
    except urllib.error.HTTPError as err:
        raw_err = err.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw_err)
        except json.JSONDecodeError:
            payload = {"error": raw_err}
        return err.code, dict(err.headers.items()), payload


def service_headers(key: str, extra_prefer: str = "return=representation") -> dict[str, str]:
    """Build correct headers for service_role — Prefer header must be a single value."""
    return {
        "Content-Type": "application/json",
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Prefer": extra_prefer,
        "Accept": "application/json",
    }


def upsert_rows(
    base_rest: str,
    table: str,
    rows: list[dict[str, Any]],
    key: str,
    on_conflict: str,
) -> list[dict[str, Any]]:
    """POST upsert — single Prefer header value (critical fix)."""
    endpoint = f"{base_rest}/{table}?on_conflict={urllib.parse.quote(on_conflict)}"
    # ✅ FIX: Prefer header must be ONE value, not two comma-separated values
    headers = service_headers(key, "resolution=merge-duplicates,return=representation")
    status, _, payload = http_request(endpoint, "POST", headers, body=rows)
    if status < 200 or status >= 300:
        raise RuntimeError(f"Upsert into {table} failed ({status}): {payload}")
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict) and isinstance(payload.get("data"), list):
        return payload["data"]  # type: ignore[return-value]
    return []


def insert_rows(
    base_rest: str,
    table: str,
    rows: list[dict[str, Any]],
    key: str,
) -> list[dict[str, Any]]:
    """POST insert only (no upsert) — for tables without unique constraints."""
    endpoint = f"{base_rest}/{table}"
    headers = service_headers(key, "return=representation")
    status, _, payload = http_request(endpoint, "POST", headers, body=rows)
    if status < 200 or status >= 300:
        raise RuntimeError(f"Insert into {table} failed ({status}): {payload}")
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict) and isinstance(payload.get("data"), list):
        return payload["data"]  # type: ignore[return-value]
    return []


def apply_migration(values: dict[str, str]) -> None:
    print("[1/4] Applying migration SQL...")
    db_url = values.get("DB_DIRECT_URL", "").strip()
    if not db_url:
        print("  - Skipped: DB_DIRECT_URL not set (migration already run manually)")
        return
    try:
        import psycopg2  # type: ignore
    except ModuleNotFoundError:
        print(f"  - Skipped: install psycopg2 with: {sys.executable} -m pip install psycopg2-binary")
        return
    try:
        conn = psycopg2.connect(db_url)
        conn.autocommit = False
        with conn.cursor() as cur:
            cur.execute(MIGRATION_PATH.read_text(encoding="utf-8"))
        conn.commit()
        conn.close()
        print("  - Migration applied successfully")
    except Exception as exc:
        print(f"  - Migration failed (already applied?): {exc}")


def direct_import(supabase_url: str, key: str) -> dict[str, Any]:
    print("[2/4] Importing manifest via direct REST...")
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    base = f"{supabase_url.rstrip('/')}/rest/v1"

    # ── 1. Upsert tour ──────────────────────────────────────────────
    tour_record = {
        "slug": TOUR_SLUG,
        "name": manifest["tour_name"],
        "description": None,
        "cover_image": (manifest["nodes"][0]["thumbnail"]
                        if manifest.get("nodes") else None),
        "status": "published",
        "mapbox_style": manifest["mapbox"]["style"],
        "center_lat": manifest["mapbox"]["center"]["lat"],
        "center_lng": manifest["mapbox"]["center"]["lng"],
        "zoom_level": manifest["mapbox"]["zoom"],
    }
    tour_rows = upsert_rows(base, "tours", [tour_record], key, "slug")
    if not tour_rows:
        raise RuntimeError("No tour row returned after upsert")
    tour_id = str(tour_rows[0]["id"])
    print(f"  - Tour upserted: id={tour_id}")

    # ── 2. Upsert nodes ─────────────────────────────────────────────
    node_rows = []
    for idx, node in enumerate(manifest.get("nodes", [])):
        if not isinstance(node, dict):
            continue
        tile_levels = node.get("tile_info", {}).get("levels") or []
        node_rows.append({
            "tour_id": tour_id,
            "node_key": node["id"],
            "name": node["name"],
            "panorama_url": node.get("url", ""),
            "thumbnail_url": node.get("thumbnail", ""),
            "tiles_base_url": node.get("tiles_url", ""),
            "tile_levels": tile_levels,
            "gps_lat": node["gps"]["lat"],
            "gps_lng": node["gps"]["lng"],
            "gps_altitude": node["gps"]["alt"],
            "heading": node.get("heading", 0),
            "node_type": "standalone",
            "confidence": node.get("confidence", "original"),
            "sort_order": idx,
            "is_published": True,
            "metadata": node,
        })

    upsert_rows(base, "tour_nodes", node_rows, key, "tour_id,node_key")
    print(f"  - Nodes upserted: {len(node_rows)}")

    # ── 3. Reload node IDs ──────────────────────────────────────────
    nodes_url = f"{base}/tour_nodes?tour_id=eq.{urllib.parse.quote(tour_id)}&select=id,node_key"
    st, _, stored = http_request(nodes_url, "GET", service_headers(key))
    if st >= 300 or not isinstance(stored, list):
        raise RuntimeError(f"Failed to reload nodes ({st}): {stored}")
    id_by_key = {
        str(r["node_key"]): str(r["id"])
        for r in stored
        if isinstance(r, dict) and r.get("node_key") and r.get("id")
    }

    # ── 4. Delete old hotspots ──────────────────────────────────────
    node_ids = list(id_by_key.values())
    if node_ids:
        ids_csv = ",".join(node_ids)
        del_url = f"{base}/hotspots?from_node=in.({ids_csv})"
        st_del, _, _ = http_request(del_url, "DELETE", service_headers(key))
        if st_del >= 300:
            print(f"  - Warning: hotspot delete returned {st_del} (may be empty, continuing)")

    # ── 5. Insert hotspots ──────────────────────────────────────────
    hotspot_rows: list[dict[str, Any]] = []
    for node in manifest.get("nodes", []):
        if not isinstance(node, dict):
            continue
        from_id = id_by_key.get(str(node.get("id", "")))
        if not from_id:
            continue
        for hs in node.get("hotspots", []):
            if not isinstance(hs, dict):
                continue
            to_id = id_by_key.get(str(hs.get("target_id", "")))
            if not to_id:
                continue
            hotspot_rows.append({
                "from_node": from_id,
                "to_node": to_id,
                "yaw": hs["yaw"],
                "pitch": hs.get("pitch", -10),
                "label": hs["label"],
                "distance_m": hs["distance_m"],
                "icon_type": "arrow",
                "is_visible": True,
            })

    if hotspot_rows:
        insert_rows(base, "hotspots", hotspot_rows, key)
    print(f"  - Hotspots inserted: {len(hotspot_rows)}")

    return {
        "success": True,
        "tour_id": tour_id,
        "nodes_processed": len(node_rows),
        "hotspots_created": len(hotspot_rows),
    }


def import_manifest(supabase_url: str, key: str) -> dict[str, Any]:
    print("[2/4] Trying Edge Function first...")
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    endpoint = f"{supabase_url.rstrip('/')}/functions/v1/import-manifest"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {key}",
    }
    status, _, payload = http_request(
        endpoint, "POST", headers,
        body={"manifest": manifest, "tour_slug": TOUR_SLUG},
    )
    if status in {401, 404, 500}:
        print(f"  - Edge Function unavailable ({status}), using direct REST")
        return direct_import(supabase_url, key)
    if status < 200 or status >= 300:
        print(f"  - Edge Function error ({status}), using direct REST")
        return direct_import(supabase_url, key)
    print(f"  - Edge Function OK: {payload}")
    return payload if isinstance(payload, dict) else {}


def verify_import(supabase_url: str, key: str) -> None:
    print("[3/4] Verifying...")
    base = f"{supabase_url.rstrip('/')}/rest/v1"
    hdrs = service_headers(key)

    st, _, tours = http_request(
        f"{base}/tours?slug=eq.{urllib.parse.quote(TOUR_SLUG)}&select=id,name,status",
        "GET", hdrs,
    )
    if st >= 300 or not isinstance(tours, list) or not tours:
        raise RuntimeError(f"Tour not found ({st}): {tours}")

    tour = tours[0]
    tour_id = str(tour["id"])

    st2, _, nodes = http_request(
        f"{base}/tour_nodes?tour_id=eq.{urllib.parse.quote(tour_id)}&select=id",
        "GET", hdrs,
    )
    node_count = len(nodes) if isinstance(nodes, list) else 0
    print(f"  ✅ Tour: {tour['name']} | Nodes: {node_count} | Status: {tour['status']}")


def main() -> None:
    try:
        values = parse_env_file(ENV_PATH)
        supabase_url = require_env(values, "VITE_SUPABASE_URL")
        key = require_env(values, "SUPABASE_SERVICE_ROLE_KEY")

        apply_migration(values)
        result = import_manifest(supabase_url, key)
        print(f"  - Result: nodes={result.get('nodes_processed')}, hotspots={result.get('hotspots_created')}")
        verify_import(supabase_url, key)
        print("[4/4] Done! Next: python scripts/upload_to_r2.py → git push")

    except (FileNotFoundError, KeyError, RuntimeError, json.JSONDecodeError) as exc:
        print(f"\n❌ Setup failed: {exc}")
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
