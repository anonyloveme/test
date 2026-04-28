"""Apply Cloudflare R2 bucket CORS from r2-cors.json."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT_DIR / '.env.local'
CORS_PATH = ROOT_DIR / 'r2-cors.json'


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        raise FileNotFoundError(f'Missing env file: {path}')

    for raw_line in path.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            values[key] = value

    return values


def require_env(values: dict[str, str], key: str) -> str:
    value = values.get(key, '').strip()
    if not value:
        raise KeyError(f'Missing required environment variable: {key}')
    return value


def load_cors_config(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f'Missing CORS config: {path}')

    payload = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(payload, dict) or 'CORSRules' not in payload:
        raise ValueError('Invalid CORS config: expected object with CORSRules')

    return payload


def build_client(values: dict[str, str]):
    try:
        import boto3
    except ModuleNotFoundError as exc:
        print('boto3 is required for this script.')
        print(f'Install it with: {sys.executable} -m pip install boto3')
        raise SystemExit(1) from exc

    account_id = require_env(values, 'R2_ACCOUNT_ID')
    access_key = require_env(values, 'R2_ACCESS_KEY_ID')
    secret_key = require_env(values, 'R2_SECRET_ACCESS_KEY')

    return boto3.client(
        's3',
        endpoint_url=f'https://{account_id}.r2.cloudflarestorage.com',
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name='auto',
    )


def configure_cors(client: Any, bucket_name: str, cors_config: dict[str, Any]) -> None:
    client.put_bucket_cors(Bucket=bucket_name, CORSConfiguration=cors_config)
    verified = client.get_bucket_cors(Bucket=bucket_name)
    rules = verified.get('CORSRules', [])

    if not rules:
        raise RuntimeError('CORS verification failed: no rules returned by bucket')


def main() -> None:
    try:
        values = parse_env_file(ENV_PATH)
        bucket_name = require_env(values, 'R2_BUCKET_NAME')
        cors_config = load_cors_config(CORS_PATH)
        client = build_client(values)

        configure_cors(client, bucket_name, cors_config)

        print(f'CORS configured successfully for {bucket_name}')
        print('Reminder: add your production domain to AllowedOrigins in r2-cors.json before running in prod.')
    except (FileNotFoundError, KeyError, ValueError, RuntimeError) as setup_error:
        print(f'R2 CORS setup failed: {setup_error}')
        raise SystemExit(1) from setup_error


if __name__ == '__main__':
    main()
