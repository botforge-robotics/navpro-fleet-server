# navpro/rmf-adapter -- the rmf-core image plus the navpro-rmf-adapter
# python package (EasyFullControl + registry-poll dynamic robot add).
#
# In production this image is what the compose rmf-core service runs
# (FLEET_ADAPTER=navpro): one container holding all RMF nodes AND the NavPro
# fleet adapter, so DDS stays container-local.
#
# Build (rmf-core must be built first):
#   docker build -t navpro/rmf-core:jazzy rmf/
#   docker build -t navpro/rmf-adapter:jazzy rmf-adapter/

ARG BASE_IMAGE=navpro/rmf-core:jazzy
FROM ${BASE_IMAGE}

COPY pyproject.toml README.md /opt/navpro-rmf-adapter/
COPY navpro_rmf_adapter/ /opt/navpro-rmf-adapter/navpro_rmf_adapter/

# nav2_msgs / action_msgs needed when NAVPRO_LOCAL_NAV2=1 (host-sim DDS).
RUN apt-get update && apt-get install -y --no-install-recommends \
        ros-jazzy-nav2-msgs \
        ros-jazzy-action-msgs \
    && rm -rf /var/lib/apt/lists/*

# Runtime deps (httpx, pyyaml, eclipse-zenoh, nudged) are already pinned in
# the base image; this just installs the package itself.
RUN pip3 install --no-cache-dir --break-system-packages \
        /opt/navpro-rmf-adapter

# Same entrypoint as rmf-core, but default to the NavPro adapter.
# Overlay the entrypoint so entrypoint fixes do not require a full rmf-base rebuild.
COPY entrypoint.sh /rmf/entrypoint.sh
RUN chmod +x /rmf/entrypoint.sh
ENV FLEET_ADAPTER=navpro

ENTRYPOINT ["/rmf/entrypoint.sh"]
