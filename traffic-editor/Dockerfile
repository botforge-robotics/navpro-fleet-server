# Full Open-RMF traffic-editor GUI in the browser via noVNC.
# https://github.com/open-rmf/rmf_traffic_editor
#
# Build:  docker compose build traffic-editor
# Run:    docker compose up -d traffic-editor
# Open:   http://<LAN_IP>/editor/  (proxied by nginx)
#
# Toolbar icons are Qt resource SVGs (:icons/*.svg). libqt5svg5 is required
# or buttons render as blank grey squares under Xvfb/noVNC.

FROM ros:jazzy

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:1 \
    QT_X11_NO_MITSHM=1 \
    LIBGL_ALWAYS_SOFTWARE=1 \
    QT_PLUGIN_PATH=/usr/lib/x86_64-linux-gnu/qt5/plugins \
    QT_QPA_PLATFORM=xcb

RUN apt-get update && apt-get install -y --no-install-recommends \
        ros-jazzy-rmf-traffic-editor \
        ros-jazzy-rmf-traffic-editor-assets \
        ros-jazzy-rmf-building-map-tools \
        libyaml-cpp-dev \
        libopencv-dev \
        qtbase5-dev \
        libqt5widgets5 \
        libqt5gui5 \
        libqt5svg5 \
        qt5-image-formats-plugins \
        xvfb \
        x11vnc \
        openbox \
        novnc \
        websockify \
        python3-numpy \
        python3-yaml \
        python3-shapely \
        mesa-utils \
        libgl1 \
        libglib2.0-0 \
        fonts-dejavu-core \
        dbus-x11 \
        wmctrl \
    && rm -rf /var/lib/apt/lists/* \
    && ls /usr/lib/x86_64-linux-gnu/qt5/plugins/imageformats/libqsvg.so \
    && ls /usr/lib/x86_64-linux-gnu/qt5/plugins/iconengines/libqsvgicon.so

WORKDIR /site

COPY entrypoint.sh /entrypoint.sh
COPY novnc-embed.html /usr/share/novnc/navpro-embed.html
RUN chmod +x /entrypoint.sh

EXPOSE 6080

ENTRYPOINT ["/entrypoint.sh"]
