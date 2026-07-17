# NavPro Fleet - Deployment Guide

End-to-end setup for a new site. Two tracks: **A) Fleet server + GUI (Docker)**
and **B) Robots**. Do A first, then B, then C to connect them.

What runs where:

| Part | Packaging | Where |
|------|-----------|-------|
| Platform API, RMF core, rmf-api-server, zenoh router, Postgres, Redis x2, nginx, Grafana/Prometheus/Loki | Docker (this repo) | Fleet server PC |
| Web GUI | Static build baked into the `nginx` image (`web-gui/`) | Browser on any LAN PC/tablet |
| Robot ROS 2 workspace (`NavProMini_ws`) | Native, systemd | Each robot Pi |
| ESP32 firmware | PlatformIO factory flash (+ OTA later) | Each robot |

The client PC installs **only Docker** - no ROS, RMF, Node, or Postgres.

## A. Fleet server + GUI (Docker) - one central PC

Prerequisites: Ubuntu 24.04 (or any Linux with Docker Engine + Compose plugin),
static LAN IP (set a DHCP reservation), on the same LAN/subnet as the robots.

1. Copy this repo (`navpro-fleet-server/`) onto the PC. The GUI source is
   included as `web-gui/` and is baked into the nginx image at build time.
2. Configure the environment:

   ```bash
   cd navpro-fleet-server
   cp .env.example .env
   nano .env          # LAN_IP, all passwords, PROVISIONING_TOKEN
   ```

3. Generate crypto material (TLS cert for nginx + the RS256 JWT pair shared by
   the Platform API and rmf-api-server - single auth system):

   ```bash
   ./scripts/gen_certs.sh
   ```

4. Start the stack (the RMF base image must be built before the adapter image
   that layers on top of it):

   ```bash
   docker compose --profile build-only build rmf-base   # RMF base (slow, once)
   docker compose build
   docker compose up -d
   docker compose ps               # all services healthy
   ```

5. Open the GUI at `https://<LAN_IP>/` (accept the self-signed cert). Log in
   with `ADMIN_USERNAME`/`ADMIN_PASSWORD` from `.env`; change the password in
   Settings. Grafana is at `https://<LAN_IP>/grafana`.
6. Validate the network layout (spike 4) once the first robot is up:

   ```bash
   ./scripts/spike4_network_check.sh bot-1
   ```

The operator can open/close the browser freely - the Docker stack keeps
running (`restart: unless-stopped`) and autostarts after a server reboot.

## B. Robots - first-time setup (per robot, once)

Firmware and the Pi image are factory-flashed identically; the operator only
does WiFi/identity via the captive portal. (Robot-side software lives in
`NavProMini_ws/src/navpromini_fleet` - see its README for Pi installation.)

1. Power on the robot. With no saved config (`/etc/navpro/fleet.yaml` absent),
   the Pi starts an access point `NavPro-Setup-XXXX`.
2. Join that AP from a phone/laptop; the setup page opens (http://10.42.0.1).
3. Enter:
   - WiFi SSID + password (the site LAN)
   - Robot name (e.g. `bot-1`), fleet name (must match `FLEET_NAME` in `.env`),
     initial level (e.g. `L1`)
   - Fleet server address = the server `LAN_IP`
   - Provisioning token = `PROVISIONING_TOKEN` from `.env`
4. Save. The Pi joins the WiFi and via systemd starts: robot bringup (Nav2 +
   battery), the zenoh client bridge to `tcp/<LAN_IP>:7447`, the mode
   publisher, and the health heartbeat.
5. The robot **self-registers into the Registry** and appears under the GUI
   **Commissioning** tab as Pending.

Re-provisioning: delete `/etc/navpro/fleet.yaml` to return the Pi to AP mode.

## C. Connect robots to a floor/map (in the GUI)

1. **No CAD?** Use **Mapping**: pick one robot → Start SLAM → drive → Save →
   upload `map.pgm` + `map.yaml` for the level.
2. Open **Building**: draw waypoints (chargers/homes), lanes, doors, lifts on
   the occupancy image → Save graph.
   - Fallback: paste a traffic_editor `building.yaml` into Import building.
3. Open **Commissioning**: for each Pending robot, set fleet, level, charger
   waypoint, home waypoint → **Activate**. Within ~5s the adapter adds the
   robot to the live Map / Overview.
4. Optional map transform (robot detail) if frames differ.
5. Submit a test patrol; verify motion and telemetry.
6. Repeat B + Commissioning for robot 2, 3, … Same hotspot flow; GUI auto-
   detects each register. Doors/lifts: **Devices → Link hardware** (HTTP or
   MQTT). Enable the `mosquitto` compose profile when using MQTT.

**There is no “Add robot by IP” dialog.** Discovery = captive-portal register.
Placement on the RMF map = Activate after the building graph has charger
waypoints.

## D. Day-2 operations

- **GUI**: open/close freely; missions and traffic continue.
- **Server reboot**: compose auto-starts; robots reconnect via zenoh.
- **Add a robot**: do B-C; zero-downtime (see spike 1 for the remove/edit
  caveat).
- **Backups**: schedule `scripts/backup.sh` via cron (Postgres dump + fleet
  snapshot, 14-generation retention).
- **Updates**: `docker compose pull && docker compose up -d` for server images;
  robot updates go through the split OTA channels (Pi / ESP32 / Config) in the
  GUI - never combined.
- **Logs**: per-robot logs in Grafana (Loki datasource); download from the GUI
  robot detail page.
- **Failure behavior** (see docs/RESILIENCE.md): if the fleet server is down,
  robots complete/abort their current Nav2 goal locally and hold; hardware
  e-stop and local obstacle avoidance never depend on the server
  (docs/SAFETY.md).

## Prerequisites checklist

- [ ] Server PC with Docker + static LAN IP (DHCP reservation).
- [ ] Site WiFi covering the operating area.
- [ ] Robots factory-flashed (firmware + Pi image) and charged.
- [ ] Chargers/docks placed; door/lift controllers reachable if used.
- [ ] Ports open on the server: 80, 443 (nginx), 7447 (zenoh).
- [ ] `.env` filled, `scripts/gen_certs.sh` run, `.env` never committed.
- [ ] `scripts/spike4_network_check.sh` passed with the first robot.
