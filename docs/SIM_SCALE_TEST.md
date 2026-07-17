# Simulation scale & resilience test (before hardware rollout)

Goal: validate deadlock-free traffic with the exact features that motivated
RMF - an elevator, doors, and a narrow one-way corridor - before any client
site. Pattern: `rmf_demos`.

## Test building (author in rmf_traffic_editor)

- 2 levels (L1, L2) connected by one lift.
- One narrow corridor on L1 modeled as a **one-way pair** (two directed lanes)
  or a single reversible lane.
- 2 chargers on L1, 1 on L2; 1 door on L2.

## Harness

**Preferred on this PC (already has `~/rmf_ws` with rmf_demos + Gazebo):**

```bash
cd navpro-fleet-server
./scripts/run_sim_scale_test.sh office   # corridor contention (2 tinyRobots)
./scripts/run_sim_scale_test.sh hotel    # lift sequencing
```

Uses `rmf_demos_gz` headless Gazebo + the rmf_demos fleet_manager. No Docker
required. Logs land in `site/sim_runs/<timestamp>_<scenario>/`.

**Docker path (when docker group access exists):**

```bash
docker compose up -d postgres redis-cache redis-streams platform-api
docker compose run --rm -e USE_SIM_TIME=true rmf-core \
  bash -lc "ros2 launch /launch/rmf_core.launch.xml use_sim_time:=true"
```

## Scenarios (all must pass)

1. **Corridor contention**: 2 robots approach the one-way corridor from
   opposite ends simultaneously -> RMF serializes entry; no deadlock, no
   timeout, both complete.
2. **Lift contention**: 2 robots request the lift for opposite directions ->
   sequenced correctly; multi-floor patrol completes.
3. **Dynamic add**: start with 1 robot mid-patrol, register robot 2 via the
   Platform API -> appears and receives tasks with NO rmf-core restart.
4. **Server kill**: `docker compose stop rmf-core` mid-navigation -> sim robots
   hold after current goal; `start` again -> tasks resubmitted from mission
   saga state, operations resume.
5. **Charge cycle**: drain a sim robot below the recharge threshold -> RMF
   sends it to a charger; it resumes work above threshold.
6. **Scale**: 4+ robots patrolling overlapping routes for 1 hour; zero
   negotiation failures/deadlocks in logs.

Record results in this file per run (date, commit, pass/fail per scenario).

## Results summary (2026-07-17, local Gazebo via `~/rmf_ws`)

| Scenario | Status | Notes |
|----------|--------|-------|
| 1. Corridor contention (office) | **PASS** | 2 tinyRobots opposite patrols, 92s, no deadlock |
| 2. Lift sequencing (hotel) | **PASS** | tinyBot_1 L1→L2→L3→L1 via Lift2, 468s, no deadlock |
| 3. Dynamic add via Platform API | pending | Needs docker/`platform-api` stack |
| 4. Server kill / resume | pending | Needs docker `rmf-core` |
| 5. Charge cycle | pending | Not exercised this run |
| 6. 4+ robots / 1 hour scale | pending | Longer soak; re-run when ready |

Harness: `./scripts/run_sim_scale_test.sh {office\|hotel}`

## Run 2026-07-17T16:16:11+05:30 (office)
- commit: n/a
- result: FAIL
- elapsed: 301s
- logs: `/mnt/68185C18185BE39A/Botforge/Projects/navpro-fleet-server/site/sim_runs/20260717_161053_office`

## Run 2026-07-17T16:19:35+05:30 (office)
- commit: n/a
- result: PASS
- elapsed: 92s
- logs: `/mnt/68185C18185BE39A/Botforge/Projects/navpro-fleet-server/site/sim_runs/20260717_161742_office`

## Run 2026-07-17T16:31:50+05:30 (hotel)
- commit: n/a
- result: FAIL
- elapsed: 603s
- logs: `/mnt/68185C18185BE39A/Botforge/Projects/navpro-fleet-server/site/sim_runs/20260717_162009_hotel`

## Run 2026-07-17T16:40:37+05:30 (hotel)
- commit: n/a
- result: PASS
- elapsed: 468s
- logs: `/mnt/68185C18185BE39A/Botforge/Projects/navpro-fleet-server/site/sim_runs/20260717_163231_hotel`
