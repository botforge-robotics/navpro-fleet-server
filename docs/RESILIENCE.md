# 24/7 Operation & Failure Handling

## Failure matrix

| Failure | Behavior | Recovery |
|---------|----------|----------|
| GUI/browser closed | No effect; RMF keeps dispatching/negotiating | Reopen URL |
| Robot Pi reboots | Robot rejoins via zenoh; adapter re-adds it (dynamic add); resumes tasks | Automatic |
| Fleet server down | Dispatch/negotiation stop. Robots complete or abort the current Nav2 goal locally and hold; they do not enter shared/one-way/lift zones | `restart: unless-stopped` + compose autostart on boot |
| Network partition (robot) | zenoh client auto-reconnects; robot holds if it loses the adapter mid-lane | Automatic |
| Postgres down | Platform API returns 503 for durable ops; live view (Redis cache) keeps serving; events buffer in redis-streams | Compose restarts postgres; consumers drain the stream |
| redis-streams down | Event publishing degrades to Postgres-direct writes (events table); consumers resume from last-acked ID on recovery | Automatic (AOF persistence) |
| redis-cache down | Live view degraded (REST fallback from Postgres); no data loss by design (cache is disposable) | Automatic |

## Graceful rmf-core reload (fleet-level config changes / robot removal)

Dynamic robot ADD needs no reload (docs/SPIKES.md spike 1). For remove/edit:

1. Platform marks the fleet `reloading` (new mission submission blocked).
2. Waits until no robot is inside a one-way lane, door, or lift and all are
   idle or at a safe waypoint.
3. Restarts only the `rmf-core` container; in-progress RMF tasks are
   resubmitted by the platform from mission saga state.
4. Fleet returns to `active`.

## Backups & snapshots

- `scripts/ops/backup.sh` (cron): Postgres dump (platform + rmf_api DBs) and a
  fleet snapshot (site/, compose, configs), 14-generation retention.
- Restore: fresh PC -> install Docker -> restore `site/` + `.env` + certs ->
  `psql` restore -> `docker compose up -d`.

## Future high availability (architected, not built)

- Postgres primary + replica (streaming replication); redis-streams AOF is
  already restart-safe; redis-cache needs nothing.
- Platform API and RMF Adapter are stateless (all state in Postgres/Redis/site),
  so a standby server can take over by restoring the volume trio.
- The Registry being the source of truth makes regenerating RMF config on a
  standby trivial. No current design choice blocks HA; it is simply not wired.
