# Week-1 Spike Results

Load-bearing assumptions validated (or scoped) before building around them.
Sources: Open-RMF `rmf_ros2` / `rmf-web` upstream docs and issue tracker (checked 2026-07).

## Spike 1 - Dynamic robot add without restarting rmf-core

**Question:** Does the fleet adapter pick up a newly-registered robot from regenerated
config without a service bounce, or does rmf-core need a restart?

**Answer: dynamic ADD is supported at runtime; REMOVE/EDIT is not.**

- The `EasyFullControl` API (`rmf_fleet_adapter`) exposes
  `fleet_handle.add_robot(name, initial_state, configuration, callbacks)` which is
  explicitly designed to register robots **while the adapter is running**. The
  `rmf_demos` fleet adapter does exactly this: its `update_robot()` loop calls
  `add_robot()` the first time a robot appears from the fleet-manager API.
- Upstream confirms (rmf_ros2 issue #523) that **restarting the fleet adapter node
  stops the remaining robots** and in-progress tasks must be resubmitted. So a
  restart is NOT acceptable as the normal "add robot" path.

**Consequence for our design (implemented in `rmf-adapter/`):**

- Our fleet adapter process polls the Platform API registry
  (`GET /api/v1/robots?fleet=...&status=active`) and calls `add_robot()` for any
  robot it has not yet added. Adding robot N+1 is therefore **zero-downtime**.
  The regenerated `site/fleet_config/*.yaml` is only read at startup for
  fleet-level config (traits, battery system, transforms); per-robot entries are
  discovered live.
- **Removing** a robot or changing fleet-level traits still requires an adapter
  restart. The Platform API performs this as a *graceful reload*: it marks the
  fleet `reloading`, waits for robots to reach a safe/idle state (no robot inside
  a one-way lane, door, or lift), then bounces only the `rmf-core` container.
  DEPLOYMENT.md documents this honestly.

## Spike 2 - rmf-dashboard-framework extension points

**Question:** Clean extension points for custom panels/routes, or fork internals?

**Answer: clean extension points exist; no fork needed.**

- `rmf-dashboard-framework` (in `open-rmf/rmf-web`, Apache-2.0) is a React library
  with a **MicroApp architecture**: you compose a dashboard by passing
  `tabs: [{ name, route, element }]` to the `<RmfDashboard>` component and register
  micro-apps (`MicroAppManifest`) in an `appRegistry`. Stock micro-apps:
  `createMapApp`, `doorsApp`, `liftsApp`, `robotsApp`, `tasksApp`,
  `robotMutexGroupsApp`.
- Custom pages (workflow builder, registry, device panels, health) are just **new
  tabs/micro-apps** in the same shell - exactly what the framework was built for
  (upstream describes it as "a launching-off point for system integrators").
- `<RmfDashboard apiServerUrl=... trajectoryServerUrl=...>` takes arbitrary base
  URLs, so the generated `api-client` points at **our Platform API proxy** with no
  frontend change. It is MUI-based, so `uidesign.json` tokens apply as an MUI theme.
- Caveat: the framework is **not published to npm** - it is consumed from source
  (upstream `docs/getting-started.md` covers this). Our GUI vendors it via
  `web-gui/` packages (Stage 2) and ships a fully working
  shell without it (Stage 1).

## Spike 3 - api-server default auth and JWT bridging

**Question:** What auth does `rmf_api_server` ship with, and how do we bridge it
with our JWT/RBAC so there is exactly ONE auth system?

**Answer: api-server verifies JWTs itself; point it at OUR signing key.**

- `rmf_api_server` does not manage identities. It verifies a **JWT bearer token**
  on every request using either `jwt_public_key` (RS256, production) or
  `jwt_secret` (HS256, **default is the publicly-known string `rmfisawesome`** -
  must never ship). Configured via a Python config module referenced by the
  `RMF_API_SERVER_CONFIG` env var; it validates `aud` + `iss` and requires a
  `preferred_username` claim.
- **Bridge design (one auth system, ours):**
  1. The Platform API issues RS256 JWTs (login endpoint, users/roles in Postgres),
     with claims `preferred_username`, `aud: "rmf_api_server"`,
     `iss: "navpro-platform"`, plus our own `roles` claim for platform RBAC.
  2. `rmf_api_server` is configured with our **public key** + the same `aud`/`iss`.
     It therefore accepts exactly the tokens we mint - no Keycloak, no second login.
  3. The Platform API's RMF-compatible proxy forwards the user's token unchanged on
     proxied calls (after enforcing our RBAC + audit), so api-server-side user
     attribution still works.
  4. `rmf_api_server` is **never exposed outside the Docker network**; only the
     proxy reaches it.

## Spike 4 - Docker network mode (bridge vs host)

**Question:** Does bridge networking + single-container rmf-core + published zenoh
TCP port work on a real LAN, or is host networking required?

**Status: design validated on paper; MUST be re-validated with one real robot
before the first client install.** Verify zenoh `:7447` and robot topics
(see `scripts/README.md` / compose health).

Rationale for the chosen default (bridge):

- zenoh is plain TCP - no multicast - so a published port (`7447:7447`) is
  sufficient for robots to reach the router at `<LAN_IP>:7447`.
- All RMF ROS 2 nodes run in ONE `rmf-core` container with
  `ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST`, so DDS never crosses the bridge.
  `rmf-api-server` shares that container's network namespace
  (`network_mode: "service:rmf-core"`) so its ROS side also stays local.
- nginx keeps its normal bridge-based service discovery for GUI/API/Grafana.

Fallback if the check fails (documented, not improvised): move `zenoh-router`
(and only if strictly necessary `rmf-core`) to `network_mode: host`; nginx then
proxies those two via the host gateway address. Everything else stays on bridge.

## Verification checklist (run before first deployment)

- [ ] Zenoh router + robot topics healthy on site LAN (see `scripts/README.md`).
- [ ] Robot N+1 appears in the dashboard without restarting `rmf-core`
      (Spike 1 path, exercised end-to-end).
- [ ] Login via Platform API, then open an RMF-native dashboard view - no second
      login prompt, api-server logs show the proxied user identity (Spike 3).
