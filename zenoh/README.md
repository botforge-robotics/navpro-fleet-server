# zenoh-router

`zenoh-bridge-ros2dds` running in **router** mode. This is the single ingress
point for all robot traffic: each robot Pi runs `zenoh-bridge-ros2dds` in
**client** mode and connects to this router at `tcp/<server-lan-ip>:7447`.

Version pin: `zenoh-plugin-ros2dds` **1.5.0** (release binary), matching the
version the `free_fleet` jazzy branch is tested against and the
`eclipse-zenoh==1.5.0` Python client used by the fleet adapter. Bump all three
together or not at all.

## What it does

- Listens on `tcp/0.0.0.0:7447` (published by compose; robots use the server
  LAN IP).
- Routes only the per-robot-namespaced interfaces RMF needs (allow list in
  `zenoh-router.json5`): `*/amcl_pose`, `*/battery_state` (and the NavProMini
  native `*/battery/state`), `*/robot_mode`, `*/tf`, `*/tf_static`, `*/map`,
  `*/odom`, `*/heartbeat`, plus the `*/navigate_to_pose` action.
  free_fleet reads the flat `*/battery_state` key; the robot's
  `navpromini_fleet` package runs a `battery_relay` node that republishes
  `/battery/state` under that name (started by `fleet.launch.py`).
- Rate limits: pose 5 Hz, tf 10 Hz, battery 1 Hz, odom 5 Hz, map 0.2 Hz,
  robot_mode 2 Hz, heartbeat 1 Hz.
- Uses an isolated DDS domain (99) inside its container so no DDS traffic
  leaks in or out; the RMF side talks to it as a native zenoh client, not
  via DDS.

## What lives elsewhere

- **Robot-side client config** lives in the robot workspace
  (`NavProMini_ws`), NOT here. Each robot's bridge config sets
  `plugins.ros2dds.namespace: "/<robot_name>"`, `mode: "client"` and
  `connect.endpoints: ["tcp/<server-lan-ip>:7447"]`, with its own allow list
  and rate limits mirroring this router's. The router-side allow list is
  defense in depth, not a substitute for filtering at the robot.
- The `free_fleet_adapter` / `navpro-rmf-adapter` in the `rmf-core` container
  opens a zenoh **client** session to `tcp/zenoh-router:7447` on the compose
  bridge network.

## Compose wiring

| Item    | Value                                              |
| ------- | -------------------------------------------------- |
| Ports   | `7447:7447` (TCP, published to LAN for robots)     |
| Volumes | optional: `./zenoh/zenoh-router.json5:/zenoh/zenoh-router.json5:ro` to override the baked-in config |
| Env     | none required                                      |

## Security roadmap

Robot authentication (TLS + per-robot certs) attaches here: zenoh supports
`transport.link.tls` and `access_control` sections. Not yet enabled --
requires the provisioning-time cert issuance flow from the platform first.
