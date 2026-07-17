# @navpro/platform-api

Platform API for the NavPro fleet-management platform. It is the single contract for the GUI and integrations: platform-native endpoints (registry, workflows/missions, health, devices, OTA, analytics) plus an RMF-compatible reverse proxy at `/rmf`. PostgreSQL is the system-of-record; Redis is split into a cache instance (live state, alarms) and a streams instance (durable event bus).

Built inside Docker (`node:22-alpine`, multi-stage). No local Node install is required.

## Endpoints

Read shapes marked "GUI" follow the GUI contract in `web-gui/src/api/types.ts` exactly.

| Method | Path | Auth | Role | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/health` | none | - | Liveness (Docker HEALTHCHECK) |
| POST | `/api/v1/auth/login` | none | - | `{username, password}` -> `{token, user}` (RS256 JWT, 12h) |
| GET | `/api/v1/robots`, `/robots/:id` | JWT | support+ | GUI Robot shape: registry row enriched with live state/health from redis-cache, `transforms[]` from `map_transform`, `mode: 'offline'` when not online, `retired` flag |
| POST/PATCH/DELETE | `/api/v1/robots`, `/robots/:id` | JWT | supervisor+ | Robot registry writes (platform shape, unchanged) |
| POST | `/api/v1/robots/:id/retire` | JWT | supervisor+ | Sets status `retired`, emits `registry.changed`, returns GUI robot |
| PUT | `/api/v1/robots/:id/transforms/:levelId` | JWT | supervisor+ | `{x,y,yaw,scale}` merged into `map_transform` keyed by levelId |
| GET | `/api/v1/robots/:id/ota` | JWT | support+ | Robot's rollout rows with embedded artifact info |
| POST | `/api/v1/robots/register` | `X-Provisioning-Token` | - | Robot self-registration (upsert by serial; `unprovisioned -> active` once fleet+level assigned) |
| GET | `/api/v1/levels`, `/levels/:id` | JWT | support+ | GUI Level shape: `{id,name,buildingId,imageUrl,metersPerPixel,originX,originY}` |
| GET | `/api/v1/fleets` | JWT | support+ | GUI Fleet shape: `{id,name,robotCount}` |
| POST/PATCH/DELETE | `/api/v1/fleets`, `/levels`, `/buildings` | JWT | supervisor+ | Registry writes (platform shape) |
| GET | `/api/v1/alarms?active=true` | JWT | support+ | GUI Alarm[] from redis-cache `alarms:*` keys |
| GET | `/api/v1/server/info` | JWT | support+ | `{version, rmfConnected (2s probe, 30s cache), uptimeSeconds}` |
| GET | `/api/v1/site/files/*` | JWT | support+ | Static files from `SITE_DIR` (path-traversal safe); serves level `imageUrl` |
| POST | `/api/v1/site/generate` | JWT | supervisor+ | Regenerate RMF artifacts into `SITE_DIR` (also auto-runs on `registry.changed` events) |
| GET | `/api/v1/workflows`, `/workflows/:id` | JWT | support+ | GUI Workflow shape `{id,name,description,latestVersion,createdAt,updatedAt}` |
| GET/POST | `/api/v1/workflows/:id/versions` | JWT | write: operator+ | GUI WorkflowVersion shape; POST accepts `{definition:{steps}}` or bare `{steps}` (both onFailure formats) |
| POST/DELETE | `/api/v1/workflows` / `/workflows/:id` | JWT | operator+/supervisor+ | Create / delete workflow |
| GET/POST | `/api/v1/missions`, `/missions/:id` | JWT | submit: operator+ | GUI Mission shape with embedded `steps[]`; submit `{workflowId, version?, fleet, robot?}` |
| POST | `/api/v1/missions/:id/cancel` / `/retry` / `/skip-step` | JWT | operator+ | Mission control |
| POST | `/api/v1/missions/:id/steps/:stepId/retry` / `/skip` | JWT | operator+ | Step-targeted retry/skip (step must belong to the mission) |
| POST | `/api/v1/robots/:id/heartbeat` | provisioning token or JWT | - | Live state + health ingest |
| GET | `/api/v1/robots/:id/health` | JWT | support+ | GUI HealthSample[] from `health_history` (last 500, ascending) |
| GET | `/api/v1/fleet/health` | JWT | support+ | Fleet-wide health/online summary |
| WS | `/api/v1/ws?token=<jwt>` | JWT | support+ | Pushes `{type:"robot_state",robots:Robot[]}` (1 Hz, GUI shape) and `{type:"alarm",alarm}`; accepts `{"op":"subscribe","channel":"fleet_state"}` and legacy `{"type":"subscribe","fleet":...}` |
| GET | `/api/v1/devices` | JWT | support+ | GUI Device[] (plugin-enriched: status/health/capabilities; type `dock`->`charger`, `custom`->`custom_action`) |
| GET | `/api/v1/devices/:id/status` / `/health` | JWT | support+ | Device plugin status/health |
| POST | `/api/v1/devices/:id/command` | JWT | operator+ | `{command, args}` via the device plugin |
| POST/PATCH/DELETE | `/api/v1/devices` | JWT | supervisor+ | Device registry writes (platform shape) |
| GET/POST | `/api/v1/ota/artifacts` | JWT | write: supervisor+ | GUI OtaArtifact shape (binaries land in `SITE_DIR/ota/<channel>/`) |
| GET/POST | `/api/v1/ota/rollouts` | JWT | write: supervisor+ | GUI OtaRollout shape: per-robot rows aggregated by `rollout_group` with status + progress |
| GET | `/api/v1/ota/next?serial=..&channel=..` | provisioning token | - | Robot pull: newest staged artifact for one channel (channels never mixed) |
| POST | `/api/v1/ota/report` | provisioning token | - | `{rolloutId, status}` install progress (per-robot rollout row id) |
| GET | `/api/v1/analytics/summary` | JWT | support+ | Minimal counts stub (full analytics is demand-driven) |
| ANY | `/rmf/**` (+ websocket upgrade) | JWT | mutations audited | RMF-compatible pass-through to `RMF_API_SERVER_URL` (`/rmf` prefix stripped, `Authorization` forwarded unchanged) |

RBAC hierarchy: `admin > supervisor > operator > support` (support is read-only). `requireRole(X)` passes for X and every higher role. Every mutating request writes an `audit_log` row.

`map_transform` on robots is keyed by **level id** (GUI convention); the config generator resolves ids to level names when emitting fleet config.

## Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `8080` | HTTP + websocket listen port |
| `DATABASE_URL` | required | PostgreSQL connection string |
| `REDIS_CACHE_URL` | required | Redis cache instance (live state, alarms; lru, no persistence) |
| `REDIS_STREAMS_URL` | required | Redis streams instance (event bus; AOF persistence) |
| `RMF_API_SERVER_URL` | `http://rmf-api-server:8000` | Proxy + task-dispatch target |
| `SITE_DIR` | `/site` | Mounted volume for generated config + OTA binaries |
| `JWT_PRIVATE_KEY_PATH` | `/keys/jwt-private.pem` | RS256 signing key (PEM) |
| `JWT_PUBLIC_KEY_PATH` | `/keys/jwt-public.pem` | RS256 verification key (PEM) |
| `JWT_ISS` | `navpro-platform` | JWT issuer claim |
| `JWT_AUD` | `rmf_api_server` | JWT audience claim (lets the api-server verify the same token) |
| `ADMIN_USERNAME` | required | Admin user seeded at startup if missing |
| `ADMIN_PASSWORD` | required | Bcrypt-hashed at startup, never stored in SQL |
| `PROVISIONING_TOKEN` | required | Shared secret for robot self-registration/heartbeat/OTA pull |

## Boundary rules (which modules may know RMF)

The platform-native core must never reference RMF. Exactly two modules are the declared RMF-aware edge:

- `src/rmf-proxy/` - the RMF-compatible pass-through layer (reverse proxy + websocket upgrade).
- `src/workflows/rmf-tasks.ts` - builds plain JSON payloads for the coordinator's REST surface and polls task state. No SDK imports, HTTP only.

Everything else (`src/models`, `src/registry`, `src/workflows` bar the file above, `src/devices`, `src/health`, ...) is platform-native. `test/contract-boundary.test.mjs` (run via `npm run test:contract`, included in `npm run ci`) scans every import/require specifier in `src/` (excluding the two exceptions) for `/rmf_|rmf-|openrmf/i` and fails the build on a match. Relative imports that resolve to the two declared exception modules are permitted - the saga engine and the door/lift device plugins are required to call the `rmf-tasks` helpers, and the bootstrap must mount the proxy; importing an actual RMF SDK/package anywhere fails.

## Saga semantics

A mission is a compiled workflow version: one `mission_steps` row per step, executed sequentially by an in-process runner. Every status transition is persisted, so on restart `resumeInFlightMissions()` picks up all `running`/`compiling` missions from the DB and continues from the first unfinished step.

- `goto`/`charge` steps are submitted as SIMPLE tasks to the fleet coordinator (patrol / charge_battery payloads built in `rmf-tasks.ts`) and polled to completion.
- `dock` publishes `robot.dock.requested` on the event bus (docking runs robot-side via Nav2 behaviors).
- `wait`, `capture_image`, `publish`, `call_service`, `custom` are platform-orchestrated (event-driven).

Per-step `onFailure` policy (default `retry`, 3 attempts). Both stored formats are accepted: the original `{policy, maxAttempts, compensation}` and the GUI's `{action, maxAttempts, backoffSeconds}`.

- `retry` - exponential backoff from `backoffSeconds` (default 1s, capped 30s) up to `maxAttempts`; exhaustion falls through to halt-and-alert.
- `compensate` - runs the declared `compensation` steps best-effort, then marks the mission `failed`.
- `halt_and_alert` - mission -> `needs_operator`, an Alarm (GUI shape) written to redis-cache (`alarms:mission:<id>`) and pushed over the websocket, `mission.needs_operator` event emitted. The operator resolves it via `/cancel`, `/retry`, `/skip-step`, or the step-targeted aliases.

Step states: `pending -> running -> done | retrying | compensating | failed | skipped`.

## Event bus

`publish(type, payload)` XADDs to the `navpro:events` stream and archives the event in the `events` table. Consumers use one consumer group per service, reclaim stuck messages with XAUTOCLAIM, and after 5 failed deliveries move a message to `navpro:events:dlq` and ack it. Built-in consumers: structured event logger, alarms materializer (`alarms:*` keys in redis-cache), and site-config regeneration on `registry.changed`.

## Development

Everything runs in Docker; `npm` is only used inside the image build.

```bash
docker build -t navpro/platform-api .
# CI checks (inside a node container):
docker run --rm -v "$PWD":/app -w /app node:22-alpine sh -c "npm install && npm run ci"
```
