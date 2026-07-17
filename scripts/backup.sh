#!/usr/bin/env bash
# Automated backup: Postgres dump + fleet snapshot (site config, registry
# snapshot, keys metadata). Schedule via cron, e.g.:
#   0 3 * * * /opt/navpro-fleet-server/scripts/backup.sh /backups
set -euo pipefail

cd "$(dirname "$0")/.."
DEST="${1:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"

# 1. Postgres (platform system-of-record + rmf_api db).
docker compose exec -T postgres pg_dumpall -U "${POSTGRES_USER:-navpro}" \
  | gzip > "$DEST/pg-$STAMP.sql.gz"

# 2. Fleet snapshot: generated site config + env template (never the .env
#    secrets themselves) + compose file, enough to rebuild the deployment.
tar czf "$DEST/fleet-snapshot-$STAMP.tar.gz" \
  site/ docker-compose.yml .env.example nginx/nginx.conf \
  observability/ redis/ 2>/dev/null

# 3. Retention: keep last 14 of each.
ls -1t "$DEST"/pg-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm --
ls -1t "$DEST"/fleet-snapshot-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm --

echo "Backup complete: $DEST/pg-$STAMP.sql.gz + fleet-snapshot-$STAMP.tar.gz"
