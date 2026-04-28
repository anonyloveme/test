from pathlib import Path
import base64, json

env = {}
for line in Path('.env.local').read_text().splitlines():
    line = line.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    k, v = line.split('=', 1)
    env[k.strip()] = v.strip().strip('"').strip("'")

key = env.get('SUPABASE_SERVICE_ROLE_KEY', 'NOT FOUND')
print('Key length:', len(key))
print('Key prefix:', key[:30] if key != 'NOT FOUND' else 'N/A')

# Decode JWT payload để xem role
try:
    parts = key.split('.')
    if len(parts) >= 2:
        payload = parts[1] + '=' * (4 - len(parts[1]) % 4)
        decoded = json.loads(base64.b64decode(payload))
        print('JWT role:', decoded.get('role', 'UNKNOWN'))
        print('Full decoded payload:', json.dumps(decoded, indent=2))
    else:
        print('Invalid JWT format')
except Exception as e:
    print('Decode error:', e)
