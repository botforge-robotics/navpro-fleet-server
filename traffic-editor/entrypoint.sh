#!/bin/bash
# Start Xvfb + Openbox + official traffic-editor + noVNC.
# Site files live in /site (compose mount). Prefer opening building.yaml if present.
# Watches /site/.traffic-editor-reload to relaunch Qt after map-editor saves
# (same floorplan.png path is otherwise cached in memory → stale drawing).
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

resolve_building() {
  BUILDING=""
  if compgen -G "/site/*.building.yaml" > /dev/null; then
    # shellcheck disable=SC2012
    BUILDING=$(ls -1 /site/*.building.yaml | head -1)
  elif [[ -f /site/building.yaml ]]; then
    BUILDING=/site/building.yaml
  fi
}

maximize_editor() {
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
}

# Editor lifecycle lives in this loop so we can kill+wait and avoid zombies,
# and so a pre-existing .traffic-editor-reload flag does not double-start on boot.
(
  set +e
  TE_PID=""
  FLAG=/site/.traffic-editor-reload
  LAST=""
  if [[ -f "${FLAG}" ]]; then
    LAST=$(cat "${FLAG}" 2>/dev/null || true)
  fi

  stop_editor() {
    if [[ -n "${TE_PID}" ]] && kill -0 "${TE_PID}" 2>/dev/null; then
      kill "${TE_PID}" 2>/dev/null || true
      wait "${TE_PID}" 2>/dev/null || true
    fi
    TE_PID=""
    pkill -x traffic-editor 2>/dev/null || true
    sleep 0.3
  }

  start_editor() {
    stop_editor
    # Drop Qt/tile caches so the same floorplan.png path is re-read from disk.
    rm -rf /root/.cache/open-robotics/traffic-editor 2>/dev/null || true
    resolve_building
    echo "[traffic-editor] launching traffic-editor ${BUILDING}"
    if [[ -n "${BUILDING}" ]]; then
      traffic-editor "${BUILDING}" &
    else
      traffic-editor &
    fi
    TE_PID=$!
    maximize_editor
  }

  start_editor

  while true; do
    if [[ -f "${FLAG}" ]]; then
      CUR=$(cat "${FLAG}" 2>/dev/null || true)
      if [[ -n "${CUR}" && "${CUR}" != "${LAST}" ]]; then
        echo "[traffic-editor] reload requested (${CUR})"
        LAST="${CUR}"
        start_editor
      fi
    fi
    sleep 1
  done
) &

# platform-api has no ROS — it writes /site/.nav-graph-rebuild and we run
# building_map_generator here (shared /site mount), then stamp .nav-graph-done.
(
  set +e
  set +u
  # shellcheck disable=SC1091
  source /opt/ros/jazzy/setup.bash
  set -u
  REQ=/site/.nav-graph-rebuild
  DONE=/site/.nav-graph-done
  LAST=""
  if [[ -f "${REQ}" ]]; then
    LAST=$(cat "${REQ}" 2>/dev/null || true)
  fi
  while true; do
    if [[ -f "${REQ}" ]]; then
      CUR=$(cat "${REQ}" 2>/dev/null || true)
      if [[ -n "${CUR}" && "${CUR}" != "${LAST}" ]]; then
        LAST="${CUR}"
        resolve_building
        mkdir -p /site/nav_graphs
        echo "[traffic-editor] nav graph rebuild (${CUR}) building=${BUILDING}"
        if [[ -z "${BUILDING}" ]]; then
          echo "error: no building.yaml" > "${DONE}"
        elif ros2 run rmf_building_map_tools building_map_generator nav \
          "${BUILDING}" /site/nav_graphs > /tmp/nav-graph-gen.log 2>&1; then
          echo "ok:${CUR}" > "${DONE}"
          echo "[traffic-editor] nav graphs written under /site/nav_graphs"
        else
          echo "error:$(tail -c 500 /tmp/nav-graph-gen.log | tr '\n' ' ')" > "${DONE}"
          echo "[traffic-editor] nav graph generation FAILED"
          cat /tmp/nav-graph-gen.log >&2 || true
        fi
      fi
    fi
    sleep 1
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
