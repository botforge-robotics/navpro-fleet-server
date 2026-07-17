#!/bin/bash
# Start Xvfb + Openbox + official traffic-editor + noVNC.
# Site files live in /site (compose mount). Prefer opening building.yaml if present.
set -eo pipefail

# ROS setup.bash references optional unset vars; allow that briefly.
set +u
# shellcheck disable=SC1091
source /opt/ros/jazzy/setup.bash
set -u

mkdir -p /tmp/.X11-unix /site
chmod 1777 /tmp/.X11-unix

# Clean stale X lock from prior crash.
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1

echo "[traffic-editor] starting Xvfb on DISPLAY=${DISPLAY}"
Xvfb "${DISPLAY}" -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
sleep 1

echo "[traffic-editor] starting openbox"
openbox &
sleep 0.5

BUILDING=""
if [[ -f /site/building.yaml ]]; then
  BUILDING=/site/building.yaml
elif compgen -G "/site/*.building.yaml" > /dev/null; then
  # shellcheck disable=SC2012
  BUILDING=$(ls -1 /site/*.building.yaml | head -1)
fi

echo "[traffic-editor] launching traffic-editor ${BUILDING}"
# Official CLI from ros-jazzy-rmf-traffic-editor:
#   https://github.com/open-rmf/rmf_traffic_editor
if [[ -n "${BUILDING}" ]]; then
  traffic-editor "${BUILDING}" &
else
  traffic-editor &
fi

echo "[traffic-editor] starting x11vnc"
x11vnc -display "${DISPLAY}" -forever -shared -rfbport 5900 -nopw -xkb -ncache 10 -ncache_cr -quiet &
sleep 0.5

NOVNC_WEB=/usr/share/novnc
if [[ ! -d "${NOVNC_WEB}" ]]; then
  NOVNC_WEB=/usr/share/novnc/utils/../
fi

echo "[traffic-editor] noVNC on :6080 (web=${NOVNC_WEB})"
exec websockify --web="${NOVNC_WEB}" 6080 localhost:5900
