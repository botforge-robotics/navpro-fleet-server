#!/usr/bin/env bash
# Spike 4 verification: bridge networking + published zenoh port + single
# container rmf-core. Run ON THE FLEET SERVER after `docker compose up -d`,
# with at least one real robot powered on and provisioned on the site LAN.
#
# PASS criteria:
#   1. zenoh router reachable from the LAN on tcp/7447.
#   2. rmf-core sees the robot's bridged topics (namespaced) via zenoh.
#   3. No DDS traffic escapes the rmf-core container.
#   4. rmf-api-server answers on the shared netns (rmf-core:8000).
set -uo pipefail

cd "$(dirname "$0")/.."
LAN_IP="$(grep -E '^LAN_IP=' .env | cut -d= -f2)"
ROBOT_NAME="${1:-}"
fail=0

echo "== 1. zenoh router reachable on ${LAN_IP}:7447 =="
if timeout 3 bash -c "cat < /dev/null > /dev/tcp/${LAN_IP}/7447"; then
  echo "PASS: port open"
else
  echo "FAIL: cannot reach ${LAN_IP}:7447 - check compose 'ports' and firewall"
  fail=1
fi

echo "== 2. robot topics visible inside rmf-core =="
if [[ -z "$ROBOT_NAME" ]]; then
  echo "SKIP: pass the robot name as arg 1 to check (e.g. $0 bot-1)"
else
  if docker compose exec -T rmf-core bash -lc \
      "source /opt/ros/jazzy/setup.bash && timeout 10 ros2 topic list" \
      | grep -q "/${ROBOT_NAME}/"; then
    echo "PASS: /${ROBOT_NAME}/* topics bridged"
  else
    echo "FAIL: no /${ROBOT_NAME}/* topics - check robot zenoh client config"
    fail=1
  fi
fi

echo "== 3. DDS confined to rmf-core (discovery range) =="
range=$(docker compose exec -T rmf-core printenv ROS_AUTOMATIC_DISCOVERY_RANGE)
if [[ "$range" == "LOCALHOST" ]]; then
  echo "PASS: ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST"
else
  echo "FAIL: discovery range is '$range'"
  fail=1
fi

echo "== 4. rmf-api-server on shared netns =="
if docker compose exec -T rmf-core bash -lc \
    "timeout 5 bash -c 'cat < /dev/null > /dev/tcp/127.0.0.1/8000'"; then
  echo "PASS: api-server listening on rmf-core:8000"
else
  echo "FAIL: api-server not reachable in rmf-core netns"
  fail=1
fi

if [[ $fail -eq 0 ]]; then
  echo "SPIKE 4: PASS - bridge networking layout validated"
else
  echo "SPIKE 4: FAIL - see docs/SPIKES.md fallback (host networking for"
  echo "zenoh-router/rmf-core only), do NOT improvise per-service"
fi
exit $fail
