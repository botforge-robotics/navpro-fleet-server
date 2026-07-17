# navpro-fleet-server

Dockerized fleet-management server for NavPro robots, built on Open-RMF
(ROS 2 Jazzy). One `docker compose up -d` brings up the whole platform;
robots and the browser GUI are the only things outside.

## Architecture (one paragraph)

The **Platform API** is the single endpoint the GUI and integrations know. It
exposes platform-native routes (`/api/v1/*`: registry, workflows/missions,
devices, health, OTA, auth) and an **RMF-compatible proxy** (`/rmf/*`) that
fronts `rmf_api_server` with our JWT auth + audit injected. The **Registry**
(PostgreSQL) is the source of truth for robots; RMF YAML is a **generated
artifact** in `site/`. Redis is split into a disposable **cache** instance and
a durable **streams** instance (event bus with consumer groups + DLQ). All RMF
ROS 2 nodes run in one `rmf-core` container (DDS never leaves it); robots
connect only via the zenoh router on TCP 7447.

## Layout

```
docker-compose.yml       # the whole stack (deferred services commented out)
.env.example             # copy to .env, fill in
DEPLOYMENT.md            # end-to-end site setup (server + robots + GUI)
platform-api/            # Node/TS: single contract; registry, workflows,
                         #   config-gen, events, health, OTA, auth, /rmf proxy
rmf/                     # rmf-core image (schedule, dispatcher, supervisors,
                         #   fleet adapter) + api-server image + launch
rmf-adapter/             # EasyFullControl fleet adapter w/ dynamic robot add
zenoh/                   # zenoh-bridge-ros2dds router (robots connect here)
nginx/                   # TLS entry: GUI + /api + /rmf + /grafana
redis/                   # split cache/streams configs
postgres/init/           # creates the separate rmf_api database
observability/           # prometheus, loki, grafana provisioning + dashboards
site/                    # GENERATED per-client config (mounted volume)
scripts/                 # gen_certs, backup, spike4 network check
docs/                    # SPIKES, SAFETY, RESILIENCE, OTA, MAP_EDITING,
                         #   DEFERRED, SIM_SCALE_TEST
```

## Quick start

```bash
cp .env.example .env && nano .env
./scripts/gen_certs.sh
docker compose --profile build-only build rmf-base   # RMF base image (slow, once)
docker compose build && docker compose up -d
# GUI: https://<LAN_IP>/   Grafana: https://<LAN_IP>/grafana
```

Full instructions: [DEPLOYMENT.md](DEPLOYMENT.md).

## Boundary rules (enforced)

- The GUI and integrations talk ONLY to the Platform API. The real
  `rmf_api_server`, Postgres, and Redis are never exposed outside the bridge
  network.
- Platform-native modules must not import RMF SDK types - enforced by
  `platform-api`'s `npm run test:contract` (CI-fatal). The `/rmf` proxy module
  and `workflows/rmf-tasks.ts` are the only declared RMF-aware code.
- Exactly ONE auth system: the Platform API mints RS256 JWTs;
  `rmf_api_server` verifies them with our public key (docs/SPIKES.md, spike 3).
- Safety is independent of all of this (docs/SAFETY.md).
