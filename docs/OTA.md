# OTA Updates - three independent channels, never combined

| Channel | Payload | Applied by |
|---------|---------|------------|
| `pi` | ROS packages / services tarball for the Pi | robot-side updater (systemd path unit polling `GET /api/v1/ota/next`) |
| `esp32` | base firmware binary (factory flash stays the baseline) | Pi flashes ESP32 over serial when idle |
| `config` | robot config bundle (fleet, level, endpoints, params) | robot-side updater rewrites `/etc/navpro/*` |

Rules enforced by the platform (`platform-api/src/ota`):

- An artifact belongs to exactly ONE channel; a rollout references one artifact.
- Rollouts are **staged**: robots only pull `staged` artifacts when **idle**
  (never mid-task - see docs/SAFETY.md), report `installing/installed/failed`.
- Every rollout is tracked per-robot in `ota_rollouts` with rollback status;
  a bad config push never requires a firmware reflash and vice-versa.
- Artifact binaries live in `site/ota/<channel>/` with sha256 recorded; robots
  verify the hash before applying.

Flow:

1. Upload/register artifact: `POST /api/v1/ota/artifacts` (+ file into
   `site/ota/<channel>/`).
2. Create rollout: `POST /api/v1/ota/rollouts {artifactId, robotIds[]}`.
3. Robots poll `GET /api/v1/ota/next?serial=...` (1/min when idle), download,
   verify sha256, apply, `POST /api/v1/ota/report`.
4. Rollback: create a rollout of the previous artifact version; the registry
   records `firmware_version` / `pi_version` / `config_version` per robot.
