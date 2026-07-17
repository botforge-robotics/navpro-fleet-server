# NavPro Fleet GUI

> **Canonical location:** this tree lives inside `navpro-fleet-server/web-gui/`.
> Production serves it from the single `navpro/fleet-web` nginx image.

Operator web GUI for the NavPro fleet-management platform. React 18 + TypeScript
(strict) + MUI v5, built with Vite.

The UI shell is based on Open-RMF's dashboard framework, kept as a **first-party
copy** under `packages/` (derived from [open-rmf/rmf-web](https://github.com/open-rmf/rmf-web),
Apache-2.0 — see `NOTICE`). Edit those packages like any other NavPro code; there
is no `vendor/` tree.

## Architecture

The GUI talks **only to the Platform API** — one base URL, two route families:

- `/api/v1/*` — platform-native REST + websocket (registry, workflows, missions, devices, health, OTA).
- `/rmf/*` — RMF-compatible proxy mirroring rmf `api-server`'s surface. The
  dashboard framework's `api-client` is pointed here; the GUI never holds an RMF,
  zenoh, or api-server address.

Auth is the Platform API's JWT: `POST /api/v1/auth/login` returns `{token, user}`.
The token is sent as `Authorization: Bearer <token>` on every call, including
`/rmf` (single auth system). Logout uses the RMF shell profile menu via
`JwtAuthenticator`.

In production, static files are served by fleet-server nginx, which also proxies
`/api`, `/rmf`, and `/grafana`. In dev, the Vite proxy forwards `/api` and `/rmf`
to `http://localhost:8080` (see `vite.config.ts`).

## Layout

```
src/
  App.tsx / DashboardRoot.tsx   Platform login gate + RMF dashboard shell
  api/                          Platform fetch/ws/auth
  components/                   Shared NavPro widgets
  pages/                        Overview, Missions, Workflows, Devices, OTA, Settings
  rmf/                          JwtAuthenticator + ambient framework typings
  theme/                        appTheme.ts (sole consumer of uidesign.json)
packages/
  rmf-dashboard-framework/      Owned RMF dashboard UI (Map/Robots/Tasks/…)
  api-client/                   RMF HTTP/WS client
  rmf-models/                   ROS message TypeScript models
```

Vite aliases in `vite.config.ts` map `rmf-dashboard-framework/*`, `api-client`,
and `rmf-models` onto `packages/`.

## Tabs (RMF shell)

| Tab | Source |
| --- | --- |
| Map / Robots / Tasks / Custom | `packages/rmf-dashboard-framework` workspaces |
| Overview / Missions / Workflows / Devices / OTA / Settings | `src/pages/*` inside the same shell |

## Dev

```bash
npm install
npm run dev      # Platform API at http://localhost:8080
npm run build
```

Or via Docker:

```bash
docker build -t navpro/fleet-gui .
```

## uidesign.json

`src/theme/appTheme.ts` maps `uidesign.json` into the MUI theme. Theming the
RMF shell to match that file is deferred; the shell currently runs under NavPro's
theme provider.
