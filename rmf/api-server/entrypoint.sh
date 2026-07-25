#!/usr/bin/env bash
# Entrypoint for navpro/rmf-api-server: source ROS, run rmf_api_server.
#
# Environment (see navpro_config.py for how these are consumed):
#   RMF_API_SERVER_DB_URL      required, e.g. postgres://rmf_api:pw@postgres:5432/rmf_api
#   RMF_API_SERVER_PUBLIC_URL  optional, URL the Platform API proxies us on
#   RMF_API_SERVER_PORT        optional, default 8000
#   JWT_PUBLIC_KEY_PATH        optional, default /keys/jwt-public.pem (ro mount)
#   JWT_AUDIENCE / JWT_ISSUER  optional, default rmf_api_server / navpro-platform
#   USE_SIM_TIME               optional, default false
#   RMF_SERVER_USE_SIM_TIME    set by upstream convention when running sims
set -euo pipefail

# ROS setup.bash references optional AMENT_* vars; nounset must be off while sourcing.
set +u
# shellcheck disable=SC1090,SC1091
source "/opt/ros/${ROS_DISTRO:-jazzy}/setup.bash"
# Overlay Alert/AlertResponse msgs built from rmf_internal_msgs main.
if [ -f /opt/rmf_msgs_ws/install/setup.bash ]; then
  # shellcheck disable=SC1091
  source /opt/rmf_msgs_ws/install/setup.bash
fi
set -u

if [ -z "${RMF_API_SERVER_DB_URL:-}" ]; then
  echo "[rmf-api-server] ERROR: RMF_API_SERVER_DB_URL is required," \
       "e.g. postgres://rmf_api:<password>@postgres:5432/rmf_api" >&2
  exit 1
fi

if [ ! -f "${JWT_PUBLIC_KEY_PATH:-/keys/jwt-public.pem}" ]; then
  echo "[rmf-api-server] ERROR: JWT public key not found at" \
       "${JWT_PUBLIC_KEY_PATH:-/keys/jwt-public.pem}." \
       "Mount the platform RS256 public key read-only at /keys." >&2
  exit 1
fi

if [ "${USE_SIM_TIME:-false}" = "true" ]; then
  export RMF_SERVER_USE_SIM_TIME=true
fi

# Upstream rmf_api_server crashes on startup when DoorState/LiftState rows were
# persisted as Tortoise models (DoorState.model_validate(row) expects dict fields).
# Wipe volatile device-state tables before boot so the server can start; live
# ROS topics repopulate them immediately after.
if command -v python3 >/dev/null 2>&1; then
  python3 - <<'PY' || true
import os, sys
url = os.environ.get("RMF_API_SERVER_DB_URL", "")
if not url.startswith("postgres"):
    sys.exit(0)
try:
    import psycopg2
except ImportError:
    sys.exit(0)
try:
    conn = psycopg2.connect(url)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(
        "TRUNCATE doorstate, liftstate, dispenserstate, "
        "ingestorstate, fleetstate, beaconstate RESTART IDENTITY CASCADE"
    )
    print("[rmf-api-server] cleared volatile device-state tables")
    cur.close()
    conn.close()
except Exception as exc:  # noqa: BLE001
    print(f"[rmf-api-server] WARN: could not clear state tables: {exc}", file=sys.stderr)
PY
fi

exec rmf_api_server "$@"
