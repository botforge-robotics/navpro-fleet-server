# zenoh-bridge-ros2dds router for the NavPro fleet server.
#
# Built from the pinned upstream release binary rather than
# eclipse/zenoh-bridge-ros2dds:latest so the version is reproducible.
# 1.5.0 is the version the free_fleet jazzy branch is tested against.
#
# Build:  docker build -t navpro/zenoh-router:1.5.0 zenoh/
# Run:    published on TCP 7447 (see docker-compose); config is baked in but
#         can be overridden with a bind mount at /zenoh/zenoh-router.json5.

FROM ubuntu:24.04 AS fetch

ARG ZENOH_BRIDGE_VERSION=1.5.0
ARG TARGETARCH=amd64

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*

# Map docker arch -> rust target triple used by upstream release artifacts.
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

FROM ubuntu:24.04

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=fetch /usr/local/bin/zenoh-bridge-ros2dds /usr/local/bin/zenoh-bridge-ros2dds
COPY zenoh-router.json5 /zenoh/zenoh-router.json5

EXPOSE 7447

ENTRYPOINT ["/usr/local/bin/zenoh-bridge-ros2dds"]
CMD ["-c", "/zenoh/zenoh-router.json5"]
