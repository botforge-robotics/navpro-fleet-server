#!/usr/bin/env bash
# Generates the site's crypto material:
#   - nginx/certs/server.{crt,key}  : self-signed TLS cert for the LAN (10y)
#   - keys/jwt-private.pem, keys/jwt-public.pem : RS256 pair used by the
#     Platform API to SIGN tokens and by rmf-api-server to VERIFY them
#     (single auth system - see docs/SPIKES.md spike 3).
# Idempotent: refuses to overwrite existing keys unless --force.
set -euo pipefail

cd "$(dirname "$0")/../.."
FORCE="${1:-}"

if [[ -f keys/jwt-private.pem && "$FORCE" != "--force" ]]; then
  echo "keys/ already exist; pass --force to regenerate (invalidates all tokens)."
  exit 1
fi

mkdir -p nginx/certs keys

LAN_IP="$(grep -E '^LAN_IP=' .env 2>/dev/null | cut -d= -f2 || true)"
LAN_IP="${LAN_IP:-127.0.0.1}"

openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
  -keyout nginx/certs/server.key -out nginx/certs/server.crt \
  -subj "/CN=navpro-fleet" \
  -addext "subjectAltName=IP:${LAN_IP},DNS:localhost,DNS:navpro-fleet.local"

openssl genrsa -out keys/jwt-private.pem 2048
openssl rsa -in keys/jwt-private.pem -pubout -out keys/jwt-public.pem
chmod 600 keys/jwt-private.pem nginx/certs/server.key

echo "Wrote nginx/certs/server.{crt,key} (SAN: ${LAN_IP}) and keys/jwt-*.pem"
