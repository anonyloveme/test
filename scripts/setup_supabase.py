"""Automate Supabase initialization for the virtual tour project.

Steps:
1. Read .env.local values.
2. Apply SQL migration (psycopg2 + DB_DIRECT_URL when available).
3. Import tour_manifest.json via Supabase Edge Function.
4. Verify tour and node records via PostgREST.
5. Print deployment next steps.
"""

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


def apply_migration(values: dict[str, str]) -> bool:
    print("[1/4] Applying migration SQL...")

    sql = MIGRATION_PATH.read_text(encoding="utf-8")
    db_direct_url = values.get("DB_DIRECT_URL", "").strip()
    if not db_direct_url:
        print("  - Skipped: DB_DIRECT_URL is not set in .env.local")
        print("  - Add DB_DIRECT_URL to run migration automatically with psycopg2")
        return False

    try:
        import psycopg2  # type: ignore
    except ModuleNotFoundError:
        print("  - Skipped: psycopg2 is not installed")
        print(f"  - Install with: {sys.executable} -m pip install psycopg2-binary")
        return False

    try:
        connection = psycopg2.connect(db_direct_url)
        connection.autocommit = False
        try:
            with connection.cursor() as cursor:
                cursor.execute(sql)
            connection.commit()
            print("  - Migration applied successfully")
            return True
        except psycopg2.Error as sql_error:  # type: ignore[attr-defined]
            connection.rollback()
            print(f"  - Migration failed: {sql_error}")
            return False
        finally:
            connection.close()
    except Exception as db_error:
        print(f"  - Database connection failed: {db_error}")
        return False


def http_request(
    url: str,
    method: str,
    headers: dict[str, str],
    body: Any = None,
) -> tuple[int, dict[str, str], Any]:
    encoded_body: bytes | None = None
    if body is not None:
        encoded_body = json.dumps(body, ensure_ascii=False).encode("utf-8")

    request = urllib.request.Request(url=url, method=method, headers=headers, data=encoded_body)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read().decode("utf-8")
            payload = json.loads(raw) if raw else None
            return response.status, dict(response.headers.items()), payload
    except urllib.error.HTTPError as error:
        raw_error = error.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw_error)
        except json.JSONDecodeError:
            payload = {"error": raw_error}
        return error.code, dict(error.headers.items()), payload


def postgrest_headers(service_role_key: str) -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Prefer": "return=representation",
        "Accept": "application/json",
    }


def upsert_json_rows(
    base_rest: str,
    table: str,
    rows: list[dict[str, Any]],
    service_role_key: str,
    on_conflict: str,
) -> list[dict[str, Any]]:
    endpoint = f"{base_rest}/{table}?on_conflict={urllib.parse.quote(on_conflict)}"
    headers = postgrest_headers(service_role_key)
    headers["Prefer"] = "resolution=merge-duplicates, return=representation"

    status, _, payload = http_request(endpoint, "POST", headers, body=rows)
    if status < 200 or status >= 300:
        raise RuntimeError(f"Upsert into {table} failed ({status}): {payload}")

    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, list):
            return data
    return []


def direct_import_manifest(supabase_url: str, service_role_key: str) -> dict[str, Any]:
    print("[2/4] Importing manifest via direct Supabase REST fallback...")

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    base_rest = f"{supabase_url.rstrip('/')}/rest/v1"

    tour_record = {
        "slug": TOUR_SLUG,
        "name": manifest["tour_name"],
        "description": None,
        "cover_image": manifest["nodes"][0]["thumbnail"] if manifest.get("nodes") else None,
        "status": "published",
        "mapbox_style": manifest["mapbox"]["style"],
        "center_lat": manifest["mapbox"]["center"]["lat"],
        "center_lng": manifest["mapbox"]["center"]["lng"],
        "zoom_level": manifest["mapbox"]["zoom"],
    }

    tour_rows = upsert_json_rows(base_rest, "tours", [tour_record], service_role_key, "slug")
    if not tour_rows:
        raise RuntimeError("Direct import failed: no tour row returned")

    tour_id = str(tour_rows[0].get("id"))
    node_rows = []
    for index, node in enumerate(manifest.get("nodes", [])):
        if not isinstance(node, dict):
            continue
        node_rows.append(
            {
                "tour_id": tour_id,
                "node_key": node["id"],
                "name": node["name"],
                "panorama_url": node["url"],
                "thumbnail_url": node["thumbnail"],
                "tiles_base_url": node["tiles_url"],
                "tile_levels": node.get("tile_info") and [node["tile_info"]] or [],
                "gps_lat": node["gps"]["lat"],
                "gps_lng": node["gps"]["lng"],
                "gps_altitude": node["gps"]["alt"],
                "heading": node["heading"],
                "node_type": node["type"],
                "confidence": node["confidence"],
                "sort_order": index,
                "is_published": True,
                "metadata": node,
            }
        )

    upsert_json_rows(base_rest, "tour_nodes", node_rows, service_role_key, "tour_id,node_key")

    node_query = f"{base_rest}/tour_nodes?tour_id=eq.{urllib.parse.quote(tour_id)}&select=id,node_key"
    status_nodes, _, stored_nodes_payload = http_request(
        node_query,
        "GET",
        {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Accept": "application/json",
        },
    )
    if status_nodes < 200 or status_nodes >= 300 or not isinstance(stored_nodes_payload, list):
        raise RuntimeError(f"Failed to reload tour nodes ({status_nodes}): {stored_nodes_payload}")

    node_id_by_key = {
        str(row.get("node_key")): str(row.get("id"))
        for row in stored_nodes_payload
        if isinstance(row, dict) and row.get("node_key") and row.get("id")
    }

    node_ids = list(node_id_by_key.values())
    if node_ids:
        delete_endpoint = f"{base_rest}/hotspots?from_node=in.({','.join(node_ids)})"
        status_delete, _, delete_payload = http_request(
            delete_endpoint,
            "DELETE",
            {
                "apikey": service_role_key,
                "Authorization": f"Bearer {service_role_key}",
                "Accept": "application/json",
            },
        )
        if status_delete < 200 or status_delete >= 300:
            raise RuntimeError(f"Failed to clear existing hotspots ({status_delete}): {delete_payload}")

    hotspot_rows: list[dict[str, Any]] = []
    for node in manifest.get("nodes", []):
        if not isinstance(node, dict):
            continue
        from_node_id = node_id_by_key.get(str(node.get("id", "")))
        if not from_node_id:
            continue
        for hotspot in node.get("hotspots", []):
            if not isinstance(hotspot, dict):
                continue
            to_node_id = node_id_by_key.get(str(hotspot.get("target_id", "")))
            if not to_node_id:
                continue
            hotspot_rows.append(
                {
                    "from_node": from_node_id,
                    "to_node": to_node_id,
                    "yaw": hotspot["yaw"],
                    "pitch": hotspot["pitch"],
                    "label": hotspot["label"],
                    "distance_m": hotspot["distance_m"],
                    "icon_type": "arrow",
                    "is_visible": True,
                }
            )

    if hotspot_rows:
        upsert_json_rows(base_rest, "hotspots", hotspot_rows, service_role_key, "from_node,to_node")

    return {
        "success": True,
        "tour_id": tour_id,
        "nodes_processed": len(node_rows),
        "hotspots_created": len(hotspot_rows),
        "fallback": "rest",
    }


def import_manifest(supabase_url: str, service_role_key: str) -> dict[str, Any]:
    print("[2/4] Importing manifest via Edge Function...")

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    endpoint = f"{supabase_url.rstrip('/')}/functions/v1/import-manifest"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {service_role_key}",
    }
    status, _, payload = http_request(
        endpoint,
        "POST",
        headers,
        body={"manifest": manifest, "tour_slug": TOUR_SLUG},
    )

    if status in {401, 404, 500}:
        print(f"  - Edge Function unavailable ({status}); falling back to direct REST import")
        return direct_import_manifest(supabase_url, service_role_key)

    if status < 200 or status >= 300 or not isinstance(payload, dict):
        raise RuntimeError(f"Manifest import failed ({status}): {payload}")

    print(
        "  - Import response: nodes_processed={nodes}, hotspots_created={hotspots}".format(
            nodes=payload.get("nodes_processed", "n/a"),
            hotspots=payload.get("hotspots_created", "n/a"),
        )
    )
    return payload


def verify_import(supabase_url: str, service_role_key: str) -> None:
    print("[3/4] Verifying imported data...")

    base_rest = f"{supabase_url.rstrip('/')}/rest/v1"
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Accept": "application/json",
        "Prefer": "count=exact",
    }

    tours_url = f"{base_rest}/tours?slug=eq.{urllib.parse.quote(TOUR_SLUG)}&select=id,name,status"
    status, _, tours_payload = http_request(tours_url, "GET", headers)
    if status < 200 or status >= 300 or not isinstance(tours_payload, list) or not tours_payload:
        raise RuntimeError(f"Tour verification failed ({status}): {tours_payload}")

    tour = tours_payload[0]
    tour_id = str(tour.get("id"))

    nodes_count_url = f"{base_rest}/tour_nodes?tour_id=eq.{urllib.parse.quote(tour_id)}&select=count"
    status_nodes, nodes_headers, nodes_payload = http_request(nodes_count_url, "GET", headers)
    if status_nodes < 200 or status_nodes >= 300:
        raise RuntimeError(f"Node count verification failed ({status_nodes}): {nodes_payload}")

    node_count = 0
    if isinstance(nodes_payload, list) and nodes_payload and isinstance(nodes_payload[0], dict):
        node_count = int(nodes_payload[0].get("count") or 0)
    elif isinstance(nodes_payload, list) and nodes_payload:
        node_count = len(nodes_payload)
    else:
        content_range = nodes_headers.get("Content-Range", "")
        if "/" in content_range:
            try:
                node_count = int(content_range.rsplit("/", 1)[1])
            except ValueError:
                node_count = 0

    print(f"  - Tour: {tour.get('name')}, Nodes: {node_count}, Status: {tour.get('status')}")


def print_next_steps() -> None:
    print("[4/4] Next steps")
    print("  - Run: python scripts/upload_to_r2.py")
    print("  - Set Cloudflare Pages environment variables")
    print("  - Deploy: git push origin main")


def main() -> None:
    try:
        values = parse_env_file(ENV_PATH)
        supabase_url = require_env(values, "VITE_SUPABASE_URL")
        service_role_key = require_env(values, "SUPABASE_SERVICE_ROLE_KEY")

        apply_migration(values)
        import_manifest(supabase_url, service_role_key)
        verify_import(supabase_url, service_role_key)
        print_next_steps()
    except (FileNotFoundError, KeyError, RuntimeError, json.JSONDecodeError) as setup_error:
        print(f"Setup failed: {setup_error}")
        raise SystemExit(1) from setup_error


if __name__ == "__main__":
    main()