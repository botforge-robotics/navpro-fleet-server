#!/bin/bash
set -eo pipefail
# Do not use `set -u` — /opt/ros/jazzy/setup.bash references unset AMENT_* vars.
source /opt/ros/jazzy/setup.bash

DEVICE_ID="${JOY_DEVICE_ID:-0}"
echo "[joy-teleop] starting joy_node device_id=${DEVICE_ID}"

# Local ROS only — Twist goes to Redis, not DDS/zenoh.
export ROS_LOCALHOST_ONLY=1

ros2 run joy joy_node --ros-args \
  -p "device_id:=${DEVICE_ID}" \
  -p deadzone:=0.08 \
  -p autorepeat_rate:=30.0 \
  -p sticky_buttons:=false &
JOY_PID=$!

cleanup() {
  kill "${JOY_PID}" 2>/dev/null || true
}
trap cleanup EXIT

echo "[joy-teleop] starting Redis teleop bridge…"
exec python3 /joy/joy_teleop_node.py
