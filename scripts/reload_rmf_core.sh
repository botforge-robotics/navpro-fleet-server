#!/usr/bin/env bash
# Bounce rmf-core after building apply / decommission (day-1 reload gate).
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Restarting rmf-core (clears .reload-requested consumers)…"
docker compose restart rmf-core
rm -f site/.reload-requested 2>/dev/null || true
echo "Done. Check: docker compose ps rmf-core"
