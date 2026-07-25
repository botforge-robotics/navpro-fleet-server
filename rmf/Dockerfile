# navpro/rmf-core -- all RMF ROS 2 nodes in one container.
#
# Contents:
#   - Open-RMF Jazzy binaries (schedule, dispatcher, supervisors, building map
#     tools, fleet adapter libs + python bindings)
#   - free_fleet (jazzy branch, pinned commit) built from source in /opt/ff_ws
#   - launch/ + config/ + entrypoint for the single-container bringup
#
# DDS never leaves this container: ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST.
# rmf-api-server joins this container's network namespace via compose
# network_mode: "service:rmf-core".
#
# Build:  docker build -t navpro/rmf-core:jazzy rmf/

FROM ros:jazzy

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# free_fleet jazzy branch, pinned 2025-08-06.
# https://github.com/open-rmf/free_fleet/tree/jazzy
ARG FREE_FLEET_REPO=https://github.com/open-rmf/free_fleet.git
ARG FREE_FLEET_REF=cc5b8cd8f36880f76d25650f24bd259799f63976

# Matches the zenoh-bridge-ros2dds 1.5.0 pin used by the zenoh-router image
# and required by the free_fleet jazzy branch.
ARG ZENOH_PYTHON_VERSION=1.5.0

# Open-RMF Jazzy binaries. Kept to what rmf_core.launch.xml actually starts
# (plus python bindings needed by free_fleet_adapter / navpro-rmf-adapter):
#   rmf-traffic-ros2        -> rmf_traffic_schedule, rmf_traffic_blockade
#   rmf-task-ros2           -> rmf_task_dispatcher
#   rmf-fleet-adapter       -> door/lift/mutex_group supervisors, adapter libs
#   rmf-fleet-adapter-python-> rmf_adapter python bindings (EasyFullControl)
#   rmf-building-map-tools  -> building_map_server
# rmw-cyclonedds-cpp is the RMW free_fleet is tested against.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        python3-pip \
        python3-colcon-common-extensions \
        ros-jazzy-rmw-cyclonedds-cpp \
        ros-jazzy-rmf-traffic-ros2 \
        ros-jazzy-rmf-task-ros2 \
        ros-jazzy-rmf-fleet-adapter \
        ros-jazzy-rmf-fleet-adapter-python \
        ros-jazzy-rmf-building-map-tools \
        ros-jazzy-rmf-fleet-msgs \
        ros-jazzy-rmf-task-msgs \
        ros-jazzy-rmf-visualization-schedule \
        ros-jazzy-tf-transformations \
    && rm -rf /var/lib/apt/lists/*

# Python deps of free_fleet (per its README, delivered via pip not rosdep).
# httpx is for the navpro-rmf-adapter registry client (installed in the
# derived rmf-adapter image, dependency pinned here so both images share it).
RUN pip3 install --no-cache-dir --break-system-packages \
        "nudged==0.3.1" \
        "eclipse-zenoh==${ZENOH_PYTHON_VERSION}" \
        "pycdr2==1.0.0" \
        "rosbags==0.9.23" \
        "httpx==0.27.2"

# Build free_fleet from source at the pinned ref.
# --packages-up-to free_fleet_adapter skips free_fleet_examples (which pulls
# simulation-only dependencies).
RUN mkdir -p /opt/ff_ws/src \
    && git clone "${FREE_FLEET_REPO}" /opt/ff_ws/src/free_fleet \
    && git -C /opt/ff_ws/src/free_fleet checkout "${FREE_FLEET_REF}" \
    && apt-get update \
    && rosdep update --rosdistro "${ROS_DISTRO}" \
    && rosdep install --from-paths /opt/ff_ws/src --ignore-src \
        --rosdistro "${ROS_DISTRO}" -yr \
        --skip-keys "python3-eclipse-zenoh python3-pycdr2 python3-rosbags python3-nudged rmf_visualization rmf_demos_tasks" \
    && rm -rf /var/lib/apt/lists/* \
    && source "/opt/ros/${ROS_DISTRO}/setup.bash" \
    && cd /opt/ff_ws \
    && colcon build --merge-install \
        --packages-up-to free_fleet_adapter \
        --cmake-args -DCMAKE_BUILD_TYPE=Release \
    && rm -rf /opt/ff_ws/build /opt/ff_ws/log /opt/ff_ws/src

COPY launch/ /rmf/launch/
COPY config/ /rmf/config/
COPY entrypoint.sh /rmf/entrypoint.sh
RUN chmod +x /rmf/entrypoint.sh

# DDS stays container-local; all RMF nodes live in this one container.
ENV RMW_IMPLEMENTATION=rmw_cyclonedds_cpp \
    ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST \
    FLEET_NAME=navpro \
    USE_SIM_TIME=false \
    FLEET_ADAPTER=free_fleet

ENTRYPOINT ["/rmf/entrypoint.sh"]
