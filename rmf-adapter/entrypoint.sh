#!/usr/bin/env bash
# Entrypoint for the navpro/rmf-core (and derived navpro/rmf-adapter) image.
# Sources ROS + the free_fleet workspace, computes file-existence guards for
# the launch, and execs ros2 launch.
#
# Environment:
#   FLEET_NAME          fleet name (default: navpro); selects
#                       /site/fleet_config/${FLEET_NAME}.yaml
#   USE_SIM_TIME        true|false (default: false)
#   FLEET_ADAPTER       navpro | free_fleet | none (default: free_fleet)
#                       "navpro" requires the navpro-rmf-adapter package
#                       (navpro/rmf-adapter image)
#   SERVER_URI          rmf-web api-server internal websocket
#                       (default: ws://localhost:8000/_internal; api-server
#                       shares this container's network namespace)
#   ZENOH_CONFIG        zenoh client config path
#                       (default: /rmf/config/zenoh-client.json5)
#   SITE_DIR            site volume mount point (default: /site)
set -euo pipefail

# ROS setup.bash references optional AMENT_* vars; nounset must be off while sourcing.
set +u
# shellcheck disable=SC1090,SC1091
source "/opt/ros/${ROS_DISTRO:-jazzy}/setup.bash"
if [ -f /opt/ff_ws/install/setup.bash ]; then
  # shellcheck disable=SC1091
  source /opt/ff_ws/install/setup.bash
fi
set -u

FLEET_NAME="${FLEET_NAME:-navpro}"
USE_SIM_TIME="${USE_SIM_TIME:-false}"
FLEET_ADAPTER="${FLEET_ADAPTER:-free_fleet}"
SERVER_URI="${SERVER_URI:-ws://localhost:8000/_internal}"
ZENOH_CONFIG="${ZENOH_CONFIG:-/rmf/config/zenoh-client.json5}"
SITE_DIR="${SITE_DIR:-/site}"

# RMF building_map_server ONLY accepts *.building.yaml (site/ often :ro).
resolve_building_config() {
  local site="${1}"
  if compgen -G "${site}/*.building.yaml" > /dev/null; then
    # shellcheck disable=SC2012
    ls -1 "${site}"/*.building.yaml | head -1
    return 0
  fi
  if [[ -f "${site}/building.yaml" ]]; then
    echo "[rmf-core] ERROR: ${site}/building.yaml exists but RMF requires" \
         "*.building.yaml. Copy to site/site.building.yaml and restart." >&2
  fi
  return 1
}

BUILDING_CONFIG=""
if BUILDING_CONFIG="$(resolve_building_config "${SITE_DIR}")"; then
  :
else
  BUILDING_CONFIG="${SITE_DIR}/site.building.yaml"
fi
FLEET_CONFIG="${SITE_DIR}/fleet_config/${FLEET_NAME}.yaml"
NAV_GRAPH="${SITE_DIR}/nav_graphs/0.yaml"

use_building_map=true
if [ ! -f "${BUILDING_CONFIG}" ]; then
  echo "[rmf-core] WARNING: no *.building.yaml under ${SITE_DIR};" \
       "building_map_server will NOT be started." >&2
  use_building_map=false
fi

start_fleet_adapter=true
use_navpro_adapter=false
case "${FLEET_ADAPTER}" in
  navpro)
    use_navpro_adapter=true
    ;;
  free_fleet)
    ;;
  none)
    start_fleet_adapter=false
    ;;
  *)
    echo "[rmf-core] ERROR: FLEET_ADAPTER must be navpro|free_fleet|none," \
         "got '${FLEET_ADAPTER}'" >&2
    exit 1
    ;;
esac

if [ "${start_fleet_adapter}" = "true" ]; then
  if [ ! -f "${FLEET_CONFIG}" ] || [ ! -f "${NAV_GRAPH}" ]; then
    echo "[rmf-core] WARNING: fleet config (${FLEET_CONFIG}) or nav graph" \
         "(${NAV_GRAPH}) missing; fleet adapter will NOT be started." \
         "Generate them via the platform, then restart this container." >&2
    start_fleet_adapter=false
  fi
fi

echo "[rmf-core] fleet=${FLEET_NAME} sim_time=${USE_SIM_TIME}" \
     "building_map=${use_building_map} fleet_adapter=${FLEET_ADAPTER}" \
     "(start=${start_fleet_adapter})"

exec ros2 launch /rmf/launch/rmf_core.launch.xml \
  use_sim_time:="${USE_SIM_TIME}" \
  fleet_name:="${FLEET_NAME}" \
  building_config_file:="${BUILDING_CONFIG}" \
  use_building_map:="${use_building_map}" \
  fleet_config_file:="${FLEET_CONFIG}" \
  nav_graph_file:="${NAV_GRAPH}" \
  server_uri:="${SERVER_URI}" \
  start_fleet_adapter:="${start_fleet_adapter}" \
  use_navpro_adapter:="${use_navpro_adapter}" \
  zenoh_config_file:="${ZENOH_CONFIG}" \
  "$@"
