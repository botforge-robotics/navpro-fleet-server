# RMF services (rmf-core, rmf-api-server, zenoh-router)

Three images make up the RMF side of the NavPro fleet server:

| Image | Built from | Role |
| --- | --- | --- |
| `navpro/rmf-core:jazzy` | `rmf/Dockerfile` | ALL RMF ROS 2 nodes in one container: traffic schedule, blockade, task dispatcher, door/lift/mutex supervisors, building map server, and the fleet adapter. Open-RMF Jazzy binaries + free_fleet (jazzy @ `cc5b8cd8`) built from source in `/opt/ff_ws`. |
| `navpro/rmf-adapter:jazzy` | `rmf-adapter/Dockerfile` (FROM rmf-core) | rmf-core + the `navpro-rmf-adapter` package. **This is the image the production rmf-core compose service runs** (`FLEET_ADAPTER=navpro`) so dynamic robot add works. The plain rmf-core image with `FLEET_ADAPTER=free_fleet` is the static-config fallback. |
| `navpro/rmf-api-server:jazzy` | `rmf/api-server/Dockerfile` | rmf-web api-server (pinned rmf-web commit `9a4fb9eb`) with NavPro RS256 JWT auth. Consumed only by the Platform API. |
| `navpro/zenoh-router:1.5.0` | `zenoh/Dockerfile` | zenoh-bridge-ros2dds router; the only ingress for robot traffic. |

## How they fit

```
robots (zenoh clients, ns=<robot>)        Platform API
        |  tcp 7447 (published)              |    ^
        v                                    v    | GET /api/v1/robots (poll)
  zenoh-router  <--- zenoh client ---  rmf-core [navpro-rmf-adapter +
                                        schedule/dispatcher/supervisors]
                                             ^ DDS (LOCALHOST, shared netns)
                                             v
                                       rmf-api-server :8000 (internal)
                                             ^  http/ws + Bearer JWT
                                             |
                                        Platform API (only consumer)
```

- DDS never leaves the rmf-core container (`ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST`,
  `rmw_cyclonedds_cpp`). rmf-api-server joins that DDS graph by sharing the
  network namespace: compose `network_mode: "service:rmf-core"`.
- The fleet adapter reaches robots exclusively through a zenoh client session
  to `tcp/zenoh-router:7447` (`rmf/config/zenoh-client.json5`).
- Robot add is dynamic (registry poll); robot remove / fleet-level config
  edits require a container bounce orchestrated by the platform. See
  `rmf-adapter/README.md`.

## Compose wiring reference

### rmf-core (production image: `navpro/rmf-adapter:jazzy`)

| Item | Value |
| --- | --- |
| Ports | none published. DDS + schedule are container-internal; port 8000 in this netns belongs to rmf-api-server. |
| Volumes | `./site:/site:ro` (building.yaml, fleet_config/, nav_graphs/, maps/) |
| Env | `FLEET_NAME` (default `navpro`), `USE_SIM_TIME` (default `false`), `FLEET_ADAPTER` = `navpro` \| `free_fleet` \| `none`, `SERVER_URI` (default `ws://localhost:8000/_internal`), `ZENOH_CONFIG` (default `/rmf/config/zenoh-client.json5`), `SITE_DIR` (default `/site`) |
| Env (navpro adapter) | `PLATFORM_API_URL` (default `http://platform-api:3000`), `PLATFORM_API_SERVICE_TOKEN` or `PLATFORM_PROVISIONING_TOKEN` (one required), `NAVPRO_REGISTRY_POLL_INTERVAL` (5), `NAVPRO_POST_ROBOT_STATE` (false), `NAVPRO_STATE_POST_INTERVAL` (2), `NAVPRO_LOG_LEVEL` (INFO) |
| Behavior guards | building_map_server is skipped if `/site/building.yaml` is missing; the fleet adapter is skipped if the fleet config or nav graph is missing (warns, core still runs). |

### rmf-api-server (`navpro/rmf-api-server:jazzy`)

| Item | Value |
| --- | --- |
| Network | `network_mode: "service:rmf-core"` -- listens on 8000 inside rmf-core's netns; NEVER published to the host. The Platform API reaches it via `http://rmf-core:8000`. |
| Volumes | `./keys:/keys:ro` (must contain `jwt-public.pem`, the platform's RS256 public key) |
| Env | `RMF_API_SERVER_DB_URL` (required, e.g. `postgres://rmf_api:<pw>@postgres:5432/rmf_api` -- its own `rmf_api` database on the shared postgres), `RMF_API_SERVER_PUBLIC_URL`, `RMF_API_SERVER_PORT` (8000), `JWT_PUBLIC_KEY_PATH` (`/keys/jwt-public.pem`), `JWT_AUDIENCE` (`rmf_api_server`), `JWT_ISSUER` (`navpro-platform`), `RMF_API_SERVER_ADMIN` (`navpro-platform`), `RMF_API_SERVER_LOG_LEVEL` (INFO), `USE_SIM_TIME`, `TZ` |
| Auth | Verifies platform-issued RS256 JWTs (aud `rmf_api_server`, iss `navpro-platform`, must carry `preferred_username`). The api-server's demo `jwt_secret` auth is disabled. |

### zenoh-router (`navpro/zenoh-router:1.5.0`)

| Item | Value |
| --- | --- |
| Ports | `7447:7447` (TCP, published -- robots connect to `tcp/<server-lan-ip>:7447`) |
| Volumes | optional config override: `./zenoh/zenoh-router.json5:/zenoh/zenoh-router.json5:ro` |
| Env | none |

## Version pins (bump together, re-verify TODO(pin-api) items)

| What | Pin |
| --- | --- |
| ROS 2 / Open-RMF | `ros:jazzy` base + `ros-jazzy-rmf-*` binaries |
| free_fleet | jazzy branch @ `cc5b8cd8f36880f76d25650f24bd259799f63976` (2025-08-06) |
| rmf-web (api-server) | main @ `9a4fb9eb0ed58cc77a98913a7651e2cfd88822bb` (2026-06-17) |
| rmf_internal_msgs (api-server overlay) | `main` (Alert msgs not in Jazzy apt; see rmf-web#1029) |
| zenoh-plugin-ros2dds / eclipse-zenoh (pip) | 1.5.0 (free_fleet jazzy requirement) |

## Build order

```bash
docker build -t navpro/zenoh-router:1.5.0 zenoh/
docker build -t navpro/rmf-core:jazzy rmf/
docker build -t navpro/rmf-adapter:jazzy rmf-adapter/
docker build -t navpro/rmf-api-server:jazzy rmf/api-server/
```
