#!/usr/bin/env bash
set -eo pipefail
# ROS setup.bash references optional unset vars under `set -u`.
set +u
source /opt/ros/jazzy/setup.bash
set -u

# Local DDS for zenoh-bridge ↔ rclpy (isolated from rmf-core).
export ROS_DOMAIN_ID="${ROS_DOMAIN_ID:-42}"
export ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST
export RMW_IMPLEMENTATION="${RMW_IMPLEMENTATION:-rmw_fastrtps_cpp}"

echo "[mapping-bridge] starting zenoh-bridge-ros2dds client…"
zenoh-bridge-ros2dds -c /bridge/zenoh-client.json5 &
BRIDGE_PID=$!

cleanup() {
  kill "$BRIDGE_PID" 2>/dev/null || true
}
trap cleanup EXIT

# Give the bridge a moment to attach to the router.
sleep 2
echo "[mapping-bridge] starting ROS node…"
exec python3 /bridge/mapping_bridge_node.py
