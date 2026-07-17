# Deferred (demand-driven) capabilities

These are intentionally NOT built yet. Every service stood up now is one more
thing operated and patched on a single PC with no redundancy. Build each when
an actual customer/need pulls it in. Hooks already exist so none require
rework.

## MQTT gateway (factory PLC/MES/SCADA integration)

- Enable the commented `mosquitto` service in docker-compose.yml (add auth +
  per-topic ACLs + TLS first; MQTT_USER/MQTT_PASSWORD in .env).
- Add a small gateway consumer in platform-api subscribing to the event bus
  (`navpro:events`) and republishing to MQTT topics; accept task requests from
  a scoped inbound topic. The event bus was designed for exactly this
  fan-out - no platform changes needed.

## Analytics & reports

- `GET /api/v1/analytics/summary` exists as a stub; Postgres already stores
  missions, robot_state_history, health_history, and events.
- When needed: Grafana dashboards first (deliveries/day, utilization, battery
  history, charging stats, traffic heatmaps from robot_state_history), in-app
  charts after.

## Digital twin / replay

- Ship **Foxglove** first: it does live view + replay for ROS 2 data out of
  the box. Robot topics are already bridged via zenoh; state history is in
  Postgres for platform-side replay export.
- Keep data export viewer-neutral. Build a Visualization Interface abstraction
  ONLY if a second backend is actually required - one interface across
  Foxglove/Three.js/Unity/WebGL is a lowest-common-denominator trap.

## Phase 3 in-app map editor

See docs/MAP_EDITING.md - build only when Phase 2 import/export is proven
insufficient.
