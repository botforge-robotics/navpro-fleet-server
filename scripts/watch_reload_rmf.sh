#!/usr/bin/env bash
# Watch site/.reload-requested and bounce rmf-core + recreate rmf-api-server.
# rmf-api-server uses network_mode: service:rmf-core, so it must be recreated
# after every rmf-core restart.
#
# IMPORTANT: compose bind mounts are resolved on the Docker *host*. This
# script always passes absolute NAVPRO_KEYS_DIR so recreating from /workdir
# never mounts an empty /workdir/keys (which crash-loops jwt and blacks the GUI).
#
# Do NOT test host paths with [ -f ] inside this container — NAVPRO_KEYS_DIR is
# a host path invisible here; trust env / docker inspect .Source instead.
set -euo pipefail

SITE_DIR="${SITE_DIR:-/site}"
FLAG="${SITE_DIR}/.reload-requested"
COMPOSE_PROJECT="${COMPOSE_PROJECT_NAME:-navpro-fleet}"
POLL_SEC="${RELOAD_POLL_SEC:-2}"

resolve_keys_dir() {
  if [[ -n "${NAVPRO_KEYS_DIR:-}" ]]; then
    printf '%s' "${NAVPRO_KEYS_DIR}"
    return 0
  fi
  local id dest
  for svc in platform-api rmf-api-server; do
    id="$(docker ps -aq \
      --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" \
      --filter "label=com.docker.compose.service=${svc}" | head -1 || true)"
    [[ -z "${id}" ]] && continue
    dest="$(docker inspect "${id}" --format '{{range .Mounts}}{{if eq .Destination "/keys"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"
    if [[ -n "${dest}" && "${dest}" != "/workdir/keys" ]]; then
      printf '%s' "${dest}"
      return 0
    fi
  done
  return 1
}

echo "[rmf-reloader] watching ${FLAG} (project=${COMPOSE_PROJECT}) keys=${NAVPRO_KEYS_DIR:-unset}"

while true; do
  if [[ -f "${FLAG}" ]]; then
    ts="$(cat "${FLAG}" 2>/dev/null || true)"
    echo "[rmf-reloader] reload requested at ${ts}"
    rm -f "${FLAG}" || true

    core_id="$(docker ps -q \
      --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" \
      --filter "label=com.docker.compose.service=rmf-core" | head -1 || true)"
    api_id="$(docker ps -aq \
      --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" \
      --filter "label=com.docker.compose.service=rmf-api-server" | head -1 || true)"

    if [[ -z "${core_id}" ]]; then
      core_id="$(docker ps -q --filter name=rmf-core | head -1 || true)"
    fi
    if [[ -z "${api_id}" ]]; then
      api_id="$(docker ps -aq --filter name=rmf-api-server | head -1 || true)"
    fi

    if [[ -n "${core_id}" ]]; then
      echo "[rmf-reloader] restarting rmf-core ${core_id}"
      docker restart "${core_id}"
      sleep 5
    else
      echo "[rmf-reloader] WARN: rmf-core container not found"
    fi

    keys_dir="$(resolve_keys_dir || true)"
    if [[ -z "${keys_dir}" ]]; then
      echo "[rmf-reloader] ERROR: NAVPRO_KEYS_DIR unset and could not discover /keys mount; skipping api recreate" >&2
    else
      echo "[rmf-reloader] recreating rmf-api-server with keys=${keys_dir}"
      export NAVPRO_KEYS_DIR="${keys_dir}"
      if [[ -f /workdir/docker-compose.yml ]]; then
        if [[ -n "${api_id}" ]]; then
          docker rm -f "${api_id}" >/dev/null 2>&1 || true
        fi
        if ! (cd /workdir && NAVPRO_KEYS_DIR="${keys_dir}" docker compose up -d --no-deps rmf-api-server); then
          echo "[rmf-reloader] WARN: compose recreate failed" >&2
        fi
      elif [[ -n "${api_id}" ]]; then
        docker restart "${api_id}" || true
      fi
    fi

    echo "[rmf-reloader] reload complete"
  fi
  sleep "${POLL_SEC}"
done
