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

# Desktop size for the Qt editor. noVNC scales this into the GUI iframe.
SCREEN_W="${NOVNC_WIDTH:-1600}"
SCREEN_H="${NOVNC_HEIGHT:-900}"

echo "[traffic-editor] starting Xvfb on DISPLAY=${DISPLAY} (${SCREEN_W}x${SCREEN_H})"
Xvfb "${DISPLAY}" -screen 0 "${SCREEN_W}x${SCREEN_H}x24" -ac +extension GLX +render -noreset &
sleep 1

echo "[traffic-editor] starting openbox"
openbox &
sleep 0.5

BUILDING=""
if compgen -G "/site/*.building.yaml" > /dev/null; then
  # shellcheck disable=SC2012
  BUILDING=$(ls -1 /site/*.building.yaml | head -1)
elif [[ -f /site/building.yaml ]]; then
  BUILDING=/site/building.yaml
fi

echo "[traffic-editor] launching traffic-editor ${BUILDING}"
# Official CLI from ros-jazzy-rmf-traffic-editor:
#   https://github.com/open-rmf/rmf_traffic_editor
if [[ -n "${BUILDING}" ]]; then
  traffic-editor "${BUILDING}" &
else
  traffic-editor &
fi

# Maximize the Qt window so the editor fills the VNC desktop (no empty openbox margins).
(
  for _ in $(seq 1 30); do
    if wmctrl -l 2>/dev/null | grep -qiE 'traffic|building|rmf'; then
      wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz 2>/dev/null || true
      wmctrl -k off 2>/dev/null || true
      break
    fi
    sleep 0.5
  done
) &

echo "[traffic-editor] starting x11vnc"
# Do NOT use -ncache: it creates a tall off-screen pixel cache, so noVNC
# scaleViewport shrinks the real desktop into a thin vertical strip.
x11vnc -display "${DISPLAY}" -forever -shared -rfbport 5900 -nopw -xkb \
  -geometry "${SCREEN_W}x${SCREEN_H}" -quiet &
sleep 0.5

NOVNC_WEB=/usr/share/novnc
if [[ ! -d "${NOVNC_WEB}" ]]; then
  NOVNC_WEB=/usr/share/novnc/utils/../
fi
# Prefer packaged path; ensure our embed is present even if novnc lives elsewhere.
if [[ -f /usr/share/novnc/navpro-embed.html ]]; then
  cp -f /usr/share/novnc/navpro-embed.html "${NOVNC_WEB}/navpro-embed.html" 2>/dev/null || true
fi

echo "[traffic-editor] noVNC on :6080 (web=${NOVNC_WEB})"
exec websockify --web="${NOVNC_WEB}" 6080 localhost:5900
