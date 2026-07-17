#!/usr/bin/env bash
# Bridge the host RMF Gazebo office demo into the NavPro GUI.
#
# Why this exists: Docker rmf-core/api-server use CycloneDDS + container-local
# discovery. Host demos use FastRTPS on ROS_DOMAIN_ID=42. They cannot see each
# other. This script:
#   1. Stops Docker rmf-core + rmf-api-server
#   2. Runs api-server on --network host (FastRTPS, domain 42, sim time)
#   3. Points platform-api at the fleet-bridge gateway (172.19.0.1:8000)
#   4. Launches the office Gazebo demo with server_uri → api-server
#
# Usage:
#   ./scripts/run_gui_rmf_demo.sh              # start and leave running
#   ./scripts/run_gui_rmf_demo.sh stop         # tear down demo bridge
#   ./scripts/run_gui_rmf_demo.sh status       # curl building_map + fleets
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT}/.env"
COMPOSE_FILE="${ROOT}/docker-compose.yml"
API_CTR="navpro-rmf-api-demo"
LOG_DIR="${ROOT}/site/sim_runs/gui_demo_$(date +%Y%m%d_%H%M%S)"
DOMAIN_ID="${ROS_DOMAIN_ID_DEMO:-42}"
# Fleet bridge gateway (platform-api → host). Override if your compose network differs.
HOST_GW="${RMF_DEMO_HOST_GW:-172.19.0.1}"
SERVER_URI="${SERVER_URI:-ws://127.0.0.1:8000/_internal}"
LAUNCH_XML="${ROOT}/scripts/gui_demo_office.launch.xml"

dc() { sg docker -c "docker compose -f '${COMPOSE_FILE}' $*"; }

login_token() {
  curl -sf -X POST "http://${LAN_IP}/api/v1/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"${ADMIN_USERNAME}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])'
}

# FastDDS SHM between host demo and the api-server container is flaky even with
# --ipc host; a one-shot transient_local republish wakes late-joining subscribers.
republish_building_map() {
  echo "[gui-demo] republishing /map for late-joining api-server..."
  python3 - <<'PY'
import rclpy, time, threading
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy, HistoryPolicy
from rmf_building_map_msgs.msg import BuildingMap

rclpy.init()
node = Node("navpro_map_republish")
qos = QoSProfile(
    history=HistoryPolicy.KEEP_LAST, depth=1,
    reliability=ReliabilityPolicy.RELIABLE,
    durability=DurabilityPolicy.TRANSIENT_LOCAL,
)
held = []
sub = node.create_subscription(BuildingMap, "map", lambda m: held.append(m), qos)
threading.Thread(target=rclpy.spin, args=(node,), daemon=True).start()
for _ in range(50):
    if held:
        break
    time.sleep(0.2)
node.destroy_subscription(sub)
if not held:
    print("no map received; skip republish")
    rclpy.shutdown()
    raise SystemExit(1)
pub = node.create_publisher(BuildingMap, "map", qos)
# Let discovery settle, then publish a few times without re-subscribing.
time.sleep(0.5)
for _ in range(5):
    pub.publish(held[0])
    time.sleep(0.2)
print("republished", held[0].name)
time.sleep(0.5)
rclpy.shutdown()
PY
}

status() {
  local tok
  tok="$(login_token)"
  echo "== GET /rmf/building_map =="
  curl -sS -o /tmp/navpro_bm.json -w "HTTP %{http_code}\n" \
    -H "Authorization: Bearer ${tok}" \
    "http://${LAN_IP}/rmf/building_map" || true
  python3 -c '
import json
try:
  d=json.load(open("/tmp/navpro_bm.json"))
  levels=d.get("levels")
  if isinstance(levels, dict):
    names=list(levels.keys())
  else:
    names=[x.get("name") for x in (levels or [])]
  print("name:", d.get("name"), "levels:", names[:8])
except Exception as e:
  print(open("/tmp/navpro_bm.json").read()[:300], e)
' 2>/dev/null || true
  echo "== GET /rmf/fleets =="
  curl -sS -H "Authorization: Bearer ${tok}" "http://${LAN_IP}/rmf/fleets" | python3 -m json.tool 2>/dev/null | head -60
}

stop_demo() {
  echo "[gui-demo] stopping..."
  "${ROOT}/scripts/kill_sim_procs.sh" >/dev/null 2>&1 || true
  pgrep -f 'gui_demo_office.launch.xml' | xargs -r kill -9 2>/dev/null || true
  sg docker -c "docker rm -f ${API_CTR}" >/dev/null 2>&1 || true
  # Restore stock rmf services (bridge-local DDS), point platform back at them.
  unset RMF_API_SERVER_URL || true
  dc up -d rmf-core rmf-api-server
  dc up -d --force-recreate --no-deps platform-api
  echo "[gui-demo] restored Docker rmf-core + rmf-api-server"
}

cmd="${1:-start}"
case "${cmd}" in
  stop) stop_demo; exit 0 ;;
  status) status; exit 0 ;;
  start) ;;
  *) echo "Usage: $0 [start|stop|status]" >&2; exit 2 ;;
esac

if [[ ! -f /home/chaitu/rmf_ws/install/setup.bash ]]; then
  echo "ERROR: ~/rmf_ws/install/setup.bash not found" >&2
  exit 1
fi

mkdir -p "${LOG_DIR}"
echo "[gui-demo] logs -> ${LOG_DIR}"

echo "[gui-demo] cleaning leftover Gazebo / RMF demo processes..."
"${ROOT}/scripts/kill_sim_procs.sh" >/dev/null 2>&1 || true
# Extra stubborn gz / hotel leftovers from prior aborted runs
killall -9 "gz sim" 2>/dev/null || true
pgrep -af 'gz sim' | awk '{print $1}' | xargs -r kill -9 2>/dev/null || true
sleep 1

echo "[gui-demo] stopping Docker rmf-core + rmf-api-server..."
dc stop rmf-api-server rmf-core >/dev/null
sg docker -c "docker rm -f ${API_CTR}" >/dev/null 2>&1 || true

echo "[gui-demo] starting host-network api-server (FastRTPS domain ${DOMAIN_ID})..."
# --network host: share DDS/UDP with the Gazebo demo on the host
# --ipc host: share /dev/shm so FastDDS shared-memory transport can deliver /map
sg docker -c "docker run -d --name ${API_CTR} --network host --ipc host \
  -e RMW_IMPLEMENTATION=rmw_fastrtps_cpp \
  -e ROS_DOMAIN_ID=${DOMAIN_ID} \
  -e ROS_AUTOMATIC_DISCOVERY_RANGE=SUBNET \
  -e FASTDDS_BUILTIN_TRANSPORTS=UDPv4 \
  -e USE_SIM_TIME=true \
  -e RMF_API_SERVER_DB_URL=sqlite:////tmp/rmf_api_gui_demo.db \
  -e RMF_API_SERVER_PUBLIC_URL=http://${LAN_IP}/rmf \
  -e RMF_API_SERVER_ADMIN=admin \
  -e JWT_PUBLIC_KEY_PATH=/keys/jwt-public.pem \
  -e JWT_AUDIENCE=rmf_api_server \
  -e JWT_ISSUER=navpro-platform \
  -v ${ROOT}/keys:/keys:ro \
  navpro/rmf-api-server:jazzy" >/dev/null

# Wait for HTTP
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:8000/docs" >/dev/null 2>&1; then
    echo "[gui-demo] api-server ready on :8000"
    break
  fi
  if [[ "${i}" -eq 60 ]]; then
    echo "[gui-demo] FAIL: api-server did not become ready" >&2
    sg docker -c "docker logs ${API_CTR}" 2>&1 | tail -40 >&2
    exit 1
  fi
  sleep 1
done

echo "[gui-demo] pointing platform-api at ${HOST_GW}:8000..."
export RMF_API_SERVER_URL="http://${HOST_GW}:8000"
dc up -d --force-recreate --no-deps platform-api

# Wait until login endpoint answers
for i in $(seq 1 40); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://${LAN_IP}/api/v1/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"${ADMIN_USERNAME}\",\"password\":\"${ADMIN_PASSWORD}\"}" || true)"
  if [[ "${code}" == "200" ]]; then
    echo "[gui-demo] platform-api ready"
    break
  fi
  if [[ "${i}" -eq 40 ]]; then
    echo "[gui-demo] FAIL: platform-api login not ready (HTTP ${code})" >&2
    exit 1
  fi
  sleep 1
done

launch_and_wait() {
  echo "[gui-demo] launching office demo (server_uri=${SERVER_URI})..."
  # shellcheck disable=SC1091
  set +u
  source /opt/ros/jazzy/setup.bash
  source /home/chaitu/rmf_ws/install/setup.bash
  set -u
  export RMW_IMPLEMENTATION=rmw_fastrtps_cpp
  export ROS_DOMAIN_ID="${DOMAIN_ID}"

  ros2 launch "${LAUNCH_XML}" \
    use_sim_time:=true headless:=true \
    server_uri:="${SERVER_URI}" \
    >"${LOG_DIR}/launch.log" 2>&1 &
  echo $! >"${LOG_DIR}/launch.pid"
  echo "[gui-demo] launch pid=$(cat "${LOG_DIR}/launch.pid")"

  echo "[gui-demo] waiting for fleet manager + building_map..."
  READY=0
  for i in $(seq 1 150); do
    if ! kill -0 "$(cat "${LOG_DIR}/launch.pid")" 2>/dev/null; then
      echo "[gui-demo] FAIL: launch exited early" >&2
      tail -n 80 "${LOG_DIR}/launch.log" >&2 || true
      exit 1
    fi
    STATUS="$(curl -sf "http://127.0.0.1:22011/open-rmf/rmf_demos_fm/status/" 2>/dev/null || true)"
    FM_OK=0
    if echo "${STATUS}" | grep -q '"success":true'; then
      COUNT="$(echo "${STATUS}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',{}).get('all_robots',[])))" 2>/dev/null || echo 0)"
      [[ "${COUNT}" -ge 2 ]] && FM_OK=1
    fi
    tok="$(login_token 2>/dev/null || echo x)"
    BM_CODE="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${tok}" \
      "http://${LAN_IP}/rmf/building_map" 2>/dev/null || echo 000)"
    if [[ "${FM_OK}" -eq 1 && "${BM_CODE}" != "200" && "${i}" -eq 20 ]]; then
      republish_building_map || true
    fi
    if [[ "${FM_OK}" -eq 1 && "${BM_CODE}" == "200" ]]; then
      READY=1
      echo "[gui-demo] ready after ~$((i*2))s (fleets via FM + building_map HTTP ${BM_CODE})"
      break
    fi
    if (( i % 15 == 0 )); then
      echo "[gui-demo] waiting... ${i}/150 (fm_ok=${FM_OK} building_map=${BM_CODE})"
      if [[ "${FM_OK}" -eq 1 && "${BM_CODE}" != "200" ]]; then
        republish_building_map || true
      fi
    fi
    sleep 2
  done

  if [[ "${READY}" -ne 1 ]]; then
    echo "[gui-demo] WARN: timed out waiting for full readiness; dumping status" >&2
    status || true
    echo "[gui-demo] launch log tail:" >&2
    tail -n 60 "${LOG_DIR}/launch.log" >&2 || true
    echo "[gui-demo] api-server log tail:" >&2
    sg docker -c "docker logs --tail 40 ${API_CTR}" 2>&1 || true
    exit 1
  fi

  status
  echo ""
  echo "[gui-demo] GUI: http://${LAN_IP}/  (${ADMIN_USERNAME} / ${ADMIN_PASSWORD})"
  echo "[gui-demo] Open Map / Robots / Tasks. Stop with: $0 stop"
  echo "[gui-demo] logs: ${LOG_DIR}"
}

launch_and_wait
