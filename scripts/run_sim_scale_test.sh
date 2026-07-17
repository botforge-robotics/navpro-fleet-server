#!/usr/bin/env bash
# Local simulated-robot runtime test (Gazebo + rmf_demos on this PC).
#
# Requires the already-built ~/rmf_ws overlay (rmf_demos + rmf_demos_gz).
# Does NOT need Docker. Uses FastRTPS (CycloneDDS is not installed here).
#
# Usage:
#   ./scripts/run_sim_scale_test.sh              # office corridor contention
#   ./scripts/run_sim_scale_test.sh hotel        # hotel lift scenario
#   ./scripts/run_sim_scale_test.sh office 300   # custom timeout seconds
set -euo pipefail

SCENARIO="${1:-office}"
TIMEOUT_S="${2:-420}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${ROOT}/site/sim_runs/$(date +%Y%m%d_%H%M%S)_${SCENARIO}"
mkdir -p "${LOG_DIR}"

if [[ ! -f /home/chaitu/rmf_ws/install/setup.bash ]]; then
  echo "ERROR: ~/rmf_ws/install/setup.bash not found. Build rmf_demos first." >&2
  exit 1
fi

# shellcheck disable=SC1091
set +u
source /opt/ros/jazzy/setup.bash
# shellcheck disable=SC1091
source /home/chaitu/rmf_ws/install/setup.bash
set -u

# Prefer FastRTPS — CycloneDDS is not packaged on this machine.
export RMW_IMPLEMENTATION="${RMW_IMPLEMENTATION:-rmw_fastrtps_cpp}"
export ROS_DOMAIN_ID="${ROS_DOMAIN_ID:-42}"

echo "[sim] logs -> ${LOG_DIR}"
echo "[sim] RMW=${RMW_IMPLEMENTATION} DOMAIN=${ROS_DOMAIN_ID} scenario=${SCENARIO} timeout=${TIMEOUT_S}s"

# Kill leftover demo / gz nodes from a previous aborted run on this domain.
# Use killall (exact name) — never pkill -f with patterns that appear in argv.
"${ROOT}/scripts/kill_sim_procs.sh" >/dev/null 2>&1 || true
sleep 1

LAUNCH_PID=""
cleanup() {
  echo "[sim] shutting down..."
  if [[ -n "${LAUNCH_PID}" ]] && kill -0 "${LAUNCH_PID}" 2>/dev/null; then
    kill "${LAUNCH_PID}" 2>/dev/null || true
    wait "${LAUNCH_PID}" 2>/dev/null || true
  fi
  "${ROOT}/scripts/kill_sim_procs.sh" >/dev/null 2>&1 || true
}
trap cleanup EXIT

case "${SCENARIO}" in
  office)
    # 2 tinyRobots in Gazebo office world — corridor / shared-lane contention.
    ros2 launch rmf_demos_gz office.launch.xml \
      use_sim_time:=true headless:=true \
      >"${LOG_DIR}/launch.log" 2>&1 &
    LAUNCH_PID=$!
    FLEET=tinyRobot
    ROBOT_A=tinyRobot1
    ROBOT_B=tinyRobot2
    DISPATCH_A=(ros2 run rmf_demos_tasks dispatch_patrol -p pantry supplies -n 1 -F "${FLEET}" -R "${ROBOT_A}" --use_sim_time)
    DISPATCH_B=(ros2 run rmf_demos_tasks dispatch_patrol -p lounge coe -n 1 -F "${FLEET}" -R "${ROBOT_B}" --use_sim_time)
    ;;
  hotel)
    # Multi-floor hotel: tinyBot cross-floor patrol (lift sequencing).
    ros2 launch rmf_demos_gz hotel.launch.xml \
      use_sim_time:=true headless:=true \
      >"${LOG_DIR}/launch.log" 2>&1 &
    LAUNCH_PID=$!
    FLEET=tinyRobot
    ROBOT_A=tinyBot_1
    ROBOT_B=""
    DISPATCH_A=(ros2 run rmf_demos_tasks dispatch_patrol -p lobby L2_room1 L3_room1 lobby -n 1 -F "${FLEET}" -R "${ROBOT_A}" --use_sim_time)
    DISPATCH_B=()
    ;;
  *)
    echo "Unknown scenario: ${SCENARIO} (office|hotel)" >&2
    exit 2
    ;;
esac

echo "[sim] waiting for Gazebo + fleet robots (${FLEET})..."
READY=0
for i in $(seq 1 120); do
  if ! kill -0 "${LAUNCH_PID}" 2>/dev/null; then
    echo "[sim] FAIL: launch exited early; see ${LOG_DIR}/launch.log" >&2
    tail -n 80 "${LOG_DIR}/launch.log" >&2 || true
    exit 1
  fi
  # fleet_manager only reports robots after slotcar publishes RobotState
  # (Gazebo world load can take 30–90s on first run).
  STATUS="$(curl -sf "http://127.0.0.1:22011/open-rmf/rmf_demos_fm/status/" 2>/dev/null || true)"
  if echo "${STATUS}" | grep -q "\"success\":true"; then
    COUNT="$(echo "${STATUS}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',{}).get('all_robots',[])))" 2>/dev/null || echo 0)"
    NEED=1
    [[ -n "${ROBOT_B}" ]] && NEED=2
    if [[ "${COUNT}" -ge "${NEED}" ]]; then
      READY=1
      echo "[sim] fleet ready (${COUNT} robots) after ~$((i*2))s"
      break
    fi
  fi
  if (( i % 10 == 0 )); then
    echo "[sim] still waiting... ${i}/120 (gz still loading models is normal)"
  fi
  sleep 2
done

if [[ "${READY}" -ne 1 ]]; then
  echo "[sim] FAIL: fleet never became ready" >&2
  tail -n 100 "${LOG_DIR}/launch.log" >&2 || true
  echo "fail" >"${LOG_DIR}/result.txt"
  exit 1
fi

# Let finishing/charge tasks settle before we inject patrols.
sleep 5

echo "[sim] dispatching tasks..."
"${DISPATCH_A[@]}" >"${LOG_DIR}/dispatch_a.log" 2>&1
echo "[sim] dispatch A exit=$?"
cat "${LOG_DIR}/dispatch_a.log" || true
if [[ ${#DISPATCH_B[@]} -gt 0 ]]; then
  "${DISPATCH_B[@]}" >"${LOG_DIR}/dispatch_b.log" 2>&1
  echo "[sim] dispatch B exit=$?"
  cat "${LOG_DIR}/dispatch_b.log" || true
fi

echo "[sim] waiting for robots to finish tasks (timeout ${TIMEOUT_S}s)..."
DEADLOCK_HINT=0
START_TS=$(date +%s)

WAIT_PIDS=()
ros2 run rmf_demos_tasks wait_for_task_complete -F "${FLEET}" -R "${ROBOT_A}" --timeout "${TIMEOUT_S}" \
  >"${LOG_DIR}/wait_a.log" 2>&1 &
WAIT_PIDS+=($!)
if [[ -n "${ROBOT_B}" ]]; then
  ros2 run rmf_demos_tasks wait_for_task_complete -F "${FLEET}" -R "${ROBOT_B}" --timeout "${TIMEOUT_S}" \
    >"${LOG_DIR}/wait_b.log" 2>&1 &
  WAIT_PIDS+=($!)
fi

WAIT_FAIL=0
for pid in "${WAIT_PIDS[@]}"; do
  if ! wait "${pid}"; then
    WAIT_FAIL=1
  fi
done

if grep -qiE 'deadlock|negotiation failed|failed to plan' "${LOG_DIR}/launch.log" 2>/dev/null; then
  DEADLOCK_HINT=1
fi

timeout 3 ros2 topic echo /fleet_states --once >"${LOG_DIR}/fleet_states.last" 2>/dev/null || true
curl -sf "http://127.0.0.1:22011/open-rmf/rmf_demos_fm/status/" >"${LOG_DIR}/fm_status.last" 2>/dev/null || true

PASS=0
if [[ "${WAIT_FAIL}" -eq 0 && "${DEADLOCK_HINT}" -eq 0 ]]; then
  PASS=1
fi
ELAPSED=$(( $(date +%s) - START_TS ))

RESULT_FILE="${LOG_DIR}/result.txt"
{
  echo "date: $(date -Is)"
  echo "scenario: ${SCENARIO}"
  echo "timeout_s: ${TIMEOUT_S}"
  echo "elapsed_s: ${ELAPSED}"
  echo "deadlock_hint: ${DEADLOCK_HINT}"
  echo "wait_fail: ${WAIT_FAIL}"
  if [[ "${PASS}" -eq 1 ]]; then
    echo "result: PASS"
  else
    echo "result: FAIL"
  fi
} | tee "${RESULT_FILE}"

{
  echo ""
  echo "## Run $(date -Is) (${SCENARIO})"
  echo "- commit: $(git -C "${ROOT}" rev-parse --short HEAD 2>/dev/null || echo n/a)"
  echo "- result: $(grep '^result:' "${RESULT_FILE}" | cut -d' ' -f2)"
  echo "- elapsed: ${ELAPSED}s"
  echo "- logs: \`${LOG_DIR}\`"
} >>"${ROOT}/docs/SIM_SCALE_TEST.md"

if [[ "${PASS}" -eq 1 ]]; then
  echo "[sim] PASS"
  exit 0
fi
echo "[sim] FAIL — see ${LOG_DIR}"
exit 1
