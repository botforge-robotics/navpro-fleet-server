# navpro-rmf-adapter

EasyFullControl RMF fleet adapter for the NavPro fleet platform. It is the
stock `free_fleet_adapter` pattern (fleet config YAML + nav graph +
`Nav2RobotAdapter` robots over zenoh) extended with **dynamic robot add**
driven by the Platform API robot registry.

Runs inside the rmf-core container in production (`navpro/rmf-adapter` image
= `navpro/rmf-core` + this package, started with `FLEET_ADAPTER=navpro`), so
all RMF DDS traffic stays container-local.

## How the dynamic-add flow works

1. The platform writes fleet-level config to
   `/site/fleet_config/<fleet>.yaml` (generated from the registry -- never
   hand-edited) and the nav graph to `/site/nav_graphs/0.yaml`.
2. On startup the adapter parses those files, creates the `rmf_adapter`
   `Adapter`, and calls `add_easy_fleet()`. No robots are added yet.
3. A poll loop (default every 5 s, `httpx`) calls
   `GET <PLATFORM_API_URL>/api/v1/robots?fleet=<name>&status=active`
   with `Authorization: Bearer <service token>` (or `X-Provisioning-Token`).
4. For every active robot not yet in the fleet, the adapter re-reads the
   fleet config YAML (the platform appends new robots there when they
   register) and constructs a free_fleet `Nav2RobotAdapter`, whose
   constructor performs the EasyFullControl `fleet_handle.add_robot()` call
   once the robot's initial pose arrives over zenoh.
   - If the robot is active in the registry but not yet present in the YAML,
     the adapter logs a warning and retries on later polls.
   - If the robot is not publishing over zenoh yet (init-pose timeout), the
     add is retried on later polls.
5. An update loop (rmf_demos/free_fleet pattern) pushes each robot's
   map/pose/battery state into RMF at `robot_state_update_frequency` from the
   fleet config, and optionally POSTs state snapshots to
   `POST /api/v1/robots/<id>/state` (`NAVPRO_POST_ROBOT_STATE=true`).

## Graceful-reload limitation

Robots can only be **added** at runtime. The EasyFullControl API has no
supported path for removing a robot from a live fleet or for mutating
fleet-level configuration (vehicle traits, battery system, reference
transforms) after `add_easy_fleet()`:

- **Remove robot**: the adapter logs a warning when an added robot goes
  inactive in the registry, but keeps it in RMF. The platform regenerates the
  YAML without the robot and bounces the rmf-core container.
- **Edit fleet-level config**: same -- regenerate, then bounce.

The platform orchestrates these bounces (robots hold at safe waypoints while
rmf-core restarts). Dynamic add itself needs no restart.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `NAVPRO_FLEET_NAME` | `navpro` | Fleet name; also selects the fleet config file |
| `NAVPRO_FLEET_CONFIG` | `/site/fleet_config/<fleet>.yaml` | EasyFullControl fleet config (platform-generated) |
| `NAVPRO_NAV_GRAPH` | `/site/nav_graphs/0.yaml` | Nav graph (platform-generated) |
| `NAVPRO_SERVER_URI` | empty | rmf-web api-server internal ws, e.g. `ws://localhost:8000/_internal` |
| `NAVPRO_ZENOH_CONFIG` | empty (zenoh defaults) | Zenoh client config; use `/rmf/config/zenoh-client.json5` in compose |
| `NAVPRO_USE_SIM_TIME` | `false` | Sim time for offline testing |
| `PLATFORM_API_URL` | `http://platform-api:3000` | Platform API base URL |
| `PLATFORM_API_SERVICE_TOKEN` | unset | Service JWT (preferred auth) |
| `PLATFORM_PROVISIONING_TOKEN` | unset | Fallback auth header `X-Provisioning-Token` |
| `NAVPRO_REGISTRY_POLL_INTERVAL` | `5.0` | Registry poll period, seconds |
| `NAVPRO_POST_ROBOT_STATE` | `false` | POST state snapshots back to the platform |
| `NAVPRO_STATE_POST_INTERVAL` | `2.0` | Snapshot period, seconds |
| `NAVPRO_LOG_LEVEL` | `INFO` | Python logging level |

One of `PLATFORM_API_SERVICE_TOKEN` / `PLATFORM_PROVISIONING_TOKEN` is
required.

## Runtime dependencies

Pip deps (`httpx`, `PyYAML`, `eclipse-zenoh==1.5.0`, `nudged`) are declared in
`pyproject.toml`. The rest come from the rmf-core image and are NOT
pip-installable: `rclpy`, `tf2_ros`, `rmf_adapter`
(ros-jazzy-rmf-fleet-adapter-python) and `free_fleet` /
`free_fleet_adapter` (built from source at the pinned jazzy commit in
`rmf/Dockerfile`). This package therefore has no standalone install target --
build the Docker image or install into an environment with those present.

## TODO(pin-api) inventory

Search the source for `TODO(pin-api)`; each marks an upstream call whose
signature must be re-verified when pinned refs are bumped:

- `Nav2RobotAdapter(...)` constructor signature (free_fleet jazzy @ cc5b8cd8).
- `fleet_handle.more().add_performable_action(...)` for plugin actions.
- Handing a `RobotConfiguration` from a freshly parsed `FleetConfiguration`
  to the live fleet handle during dynamic add (plan spike 1 validates this).

## Run locally (inside the image)

```bash
docker run --rm -it \
  -v "$(pwd)/site:/site:ro" \
  -e FLEET_ADAPTER=navpro \
  -e PLATFORM_API_URL=http://platform-api:3000 \
  -e PLATFORM_API_SERVICE_TOKEN=... \
  navpro/rmf-adapter:jazzy
```
