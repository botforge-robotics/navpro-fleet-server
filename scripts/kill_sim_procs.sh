#!/usr/bin/env bash
# Kill leftover RMF/Gazebo demo processes without matching the caller's cmdline.
set -euo pipefail
names=(
  gz
  rmf_traffic_schedule
  rmf_traffic_blockade
  rmf_task_dispatcher
  building_map_server
  door_supervisor
  lift_supervisor
  mutex_group_supervisor
  queue_manager
  parameter_bridge
  rviz2
  fleet_manager
  fleet_adapter
)
for n in "${names[@]}"; do
  # -x exact process name match (no -f), so this script's argv is safe.
  killall -9 "$n" 2>/dev/null || true
done
# Python-launched fleet_* may appear as python3; match by executable path carefully.
pgrep -f '/rmf_demos_fleet_adapter/' | xargs -r kill -9 2>/dev/null || true
pgrep -f 'ros2 launch rmf_demos' | xargs -r kill -9 2>/dev/null || true
sleep 1
echo cleaned
