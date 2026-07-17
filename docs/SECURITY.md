# Security Model (day one, even on LAN)

Baseline auth exists from the first deployment - retrofitting RBAC onto an
established free-for-all operator habit is far more painful than starting
with it. Self-signed/internal CA is acceptable for LAN; the structure extends
to cloud/multi-site later.

## TLS

- nginx terminates HTTPS/WSS for GUI, Platform API, Grafana, and Loki push.
- `scripts/gen_certs.sh` creates a self-signed cert with the LAN IP in the SAN;
  replace with CA-issued certs by swapping `nginx/certs/server.{crt,key}`.
- Internal service traffic stays on the private Docker bridge network.

## API authentication + RBAC (exactly ONE auth system)

- The Platform API mints RS256 JWTs at `POST /api/v1/auth/login`; users/roles
  live in Postgres (`users` table, bcrypt hashes).
- Roles: `admin` > `supervisor` > `operator` > `support` (read-only). Route
  guards: mission deploy (operator+), map/registry edit (supervisor+), device
  override (operator+), OTA + user management (admin).
- `rmf_api_server` verifies the SAME tokens with our public key
  (`aud=rmf_api_server`, `iss=navpro-platform`) - its default HS256 secret
  (`rmfisawesome`, publicly known) is never used. The operator never sees a
  second login. See docs/SPIKES.md spike 3.
- The real api-server, Postgres, and Redis are never exposed outside the
  Docker network.

## Robot authentication

- Provisioning/registration and heartbeats present `X-Provisioning-Token`
  (per-site secret in `.env`, rotate per site; delivered to the robot only via
  the captive-portal step over the robot's own AP).
- zenoh: restrict the router listener to the LAN interface; the router config
  allow-lists exactly the topics robots may bridge (`zenoh/zenoh-router.json5`)
  with rate limits, so a rogue device cannot flood or subscribe broadly.
  zenoh TLS + per-robot certificates are the planned hardening step (the
  bridge supports TLS transport); enable before any multi-tenant/shared-LAN
  deployment.

## Audit logging

- Every mutating Platform API request writes `audit_log` (user, action,
  resource, detail, timestamp) - mission deploys, map changes, device
  overrides, OTA, config and user changes.
- Proxied `/rmf` mutations are audited by the proxy before forwarding.

## Secrets

- All secrets live in `.env` (gitignored) and Docker env - never in YAML in
  `site/` or images. JWT private key is a mounted file readable only by
  platform-api. Robot secrets are delivered over the captive portal, stored in
  `/etc/navpro/fleet.yaml` (root-owned, 600).
