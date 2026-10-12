# navpro/rmf-api-server -- rmf-web api-server with NavPro JWT auth config.
#
# In compose this service uses network_mode: "service:rmf-core" so it shares
# the rmf-core DDS graph (LOCALHOST discovery) and its port 8000 is reachable
# by other services only through rmf-core's network namespace. It is never
# published to the host; the Platform API is the only consumer.
#
# Install strategy: pip install from the open-rmf/rmf-web monorepo at a
# pinned commit (packages/api-server subdirectory). The upstream ghcr image
# (ghcr.io/open-rmf/rmf-web/api-server) only publishes the mutable
# "jazzy-nightly" tag, so a source-pinned build is the reproducible option.
# If this pip-from-git line breaks after a bump, check that setup.py still
# lives at packages/api-server and that the package name is still
# "api_server" with a "postgres" extra.
#
# Build:  docker build -t navpro/rmf-api-server:jazzy rmf/api-server/

FROM ros:jazzy

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# open-rmf/rmf-web main, pinned 2026-06-17.
# https://github.com/open-rmf/rmf-web/commit/9a4fb9eb0ed58cc77a98913a7651e2cfd88822bb
ARG RMF_WEB_REPO=https://github.com/open-rmf/rmf-web.git
ARG RMF_WEB_REF=9a4fb9eb0ed58cc77a98913a7651e2cfd88822bb

# ROS message packages imported by api_server at runtime (see
# api_server/gateway.py) plus the RMW used across the NavPro stack.
#
# Alert/AlertResponse live only on rmf_internal_msgs main (not Jazzy apt).
# Upstream guidance: overlay msgs from source -- see open-rmf/rmf-web#1029.
ARG RMF_INTERNAL_MSGS_REF=main
RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        python3-pip \
        python3-colcon-common-extensions \
        build-essential \
        cmake \
        ros-jazzy-rmw-cyclonedds-cpp \
        ros-jazzy-rosidl-default-generators \
        ros-jazzy-rosidl-default-runtime \
        ros-jazzy-rmf-building-map-msgs \
        ros-jazzy-rmf-dispenser-msgs \
        ros-jazzy-rmf-door-msgs \
        ros-jazzy-rmf-fleet-msgs \
        ros-jazzy-rmf-ingestor-msgs \
        ros-jazzy-rmf-lift-msgs \
        ros-jazzy-rmf-task-msgs \
    && mkdir -p /opt/rmf_msgs_ws/src \
    && git clone --depth 1 --branch "${RMF_INTERNAL_MSGS_REF}" \
        https://github.com/open-rmf/rmf_internal_msgs.git \
        /opt/rmf_msgs_ws/src/rmf_internal_msgs \
    && . /opt/ros/jazzy/setup.sh \
    && cd /opt/rmf_msgs_ws \
    && colcon build --merge-install --cmake-args -DCMAKE_BUILD_TYPE=Release \
    && rm -rf /opt/rmf_msgs_ws/build /opt/rmf_msgs_ws/log /opt/rmf_msgs_ws/src \
    && rm -rf /var/lib/apt/lists/*

# api_server + postgres driver (asyncpg) at the pinned ref.
RUN pip3 install --no-cache-dir --break-system-packages \
        "api_server[postgres] @ git+${RMF_WEB_REPO}@${RMF_WEB_REF}#subdirectory=packages/api-server"

COPY navpro_config.py /rmf/api-server/navpro_config.py
COPY entrypoint.sh /rmf/api-server/entrypoint.sh
RUN chmod +x /rmf/api-server/entrypoint.sh \
    && mkdir -p /rmf/api-server/cache

ENV RMW_IMPLEMENTATION=rmw_cyclonedds_cpp \
    ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST \
    RMF_API_SERVER_CONFIG=/rmf/api-server/navpro_config.py

# Internal only -- reachable via the rmf-core service network namespace.
EXPOSE 8000

ENTRYPOINT ["/rmf/api-server/entrypoint.sh"]
