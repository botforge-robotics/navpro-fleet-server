# Mapping bridge: zenoh-bridge-ros2dds client + rclpy node that
# converts GUI Redis commands into ROS topics and /map into PNG previews.
FROM ros:jazzy-ros-base

ARG ZENOH_BRIDGE_VERSION=1.5.0
ARG TARGETARCH=amd64

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl unzip python3-pip python3-numpy \
        ros-jazzy-nav-msgs ros-jazzy-tf2-ros \
    && rm -rf /var/lib/apt/lists/*

RUN set -eu; \
    case "${TARGETARCH}" in \
      amd64) triple="x86_64-unknown-linux-gnu" ;; \
      arm64) triple="aarch64-unknown-linux-gnu" ;; \
      *) echo "unsupported arch: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/bridge.zip \
      "https://github.com/eclipse-zenoh/zenoh-plugin-ros2dds/releases/download/${ZENOH_BRIDGE_VERSION}/zenoh-plugin-ros2dds-${ZENOH_BRIDGE_VERSION}-${triple}-standalone.zip"; \
    unzip /tmp/bridge.zip -d /tmp/bridge; \
    install -m 0755 /tmp/bridge/zenoh-bridge-ros2dds /usr/local/bin/zenoh-bridge-ros2dds; \
    rm -rf /tmp/bridge /tmp/bridge.zip

RUN pip3 install --no-cache-dir --break-system-packages redis==5.0.8

WORKDIR /bridge
COPY zenoh-client.json5 /bridge/zenoh-client.json5
COPY mapping_bridge_node.py /bridge/mapping_bridge_node.py
COPY entrypoint.sh /bridge/entrypoint.sh
RUN chmod +x /bridge/entrypoint.sh

ENV REDIS_CACHE_URL=redis://redis-cache:6379
ENV ROS_DOMAIN_ID=42

ENTRYPOINT ["/bridge/entrypoint.sh"]
