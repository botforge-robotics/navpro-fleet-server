import { readFileSync } from "fs";
import path from "path";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config";
import { pool } from "../db/pool";
import { cacheRedis } from "../redis";
import { HttpError, asyncHandler, notFound } from "../http/errors";
import { requireAuth, requireAuthOrProvisioning, requireRole, auditMutations } from "../auth/middleware";
import { publish } from "../events/bus";
import { isRunnerActive, startMissionRunner } from "../workflows/saga";
import { fetchGuiRobots } from "./robot-view";
import { readAlarms } from "./alarms";
import type { GuiFleet, GuiLevel, GuiServerInfo } from "./types";
import { ONLINE_SET_KEY } from "../health/routes";
import { listLevelWaypoints, resolveWaypointPose, rmfPoseToRobotMapPose } from "../site/waypoints";
import { pushClaimMapToRobot } from "../site/map-sync";

/** GUI compat/aggregation endpoints + read overrides. Mounted before the
 *  generic registry CRUD so the enriched GET shapes shadow the raw ones.
 *  requireAuth is attached per-route (this router is mounted at /api/v1, so a
 *  router-level guard would intercept provisioning-token routes mounted later). */
export function guiRouter(): Router {
  const router = Router();

  // ---- robots (enriched reads + actions) ----

  router.get(
    "/robots",
    requireAuthOrProvisioning,
    asyncHandler(async (req, res) => {
      const entries = await fetchGuiRobots();
      const fleet = typeof req.query.fleet === "string" ? req.query.fleet : undefined;
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      let robots = entries.map((e) => ({
        ...e.robot,
        // Adapter RegistryRobot.from_json reads `fleet`; GUI uses fleetId.
        fleet: e.fleetName ?? "",
      }));
      if (fleet !== undefined) {
        robots = robots.filter((r) => r.fleet === fleet);
      }
      if (status !== undefined) {
        robots = robots.filter((r) => r.status === status);
      }
      res.json(robots);
    }),
  );

  router.get(
    "/robots/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const entries = await fetchGuiRobots(req.params.id as string);
      if (entries[0] === undefined) throw notFound("robot");
      res.json(entries[0].robot);
    }),
  );

  router.post(
    "/robots/:id/retire",
    requireAuth,
    requireRole("supervisor"),
    auditMutations,
    asyncHandler(async (req, res) => {
      const robotId = req.params.id as string;
      const { rowCount } = await pool.query("UPDATE robots SET status = 'retired' WHERE id = $1", [robotId]);
      if (rowCount === 0) throw notFound("robot");
      await publish("registry.changed", { resource: "robot", id: robotId, action: "retired" });
      const entries = await fetchGuiRobots(robotId);
      res.json(entries[0]?.robot ?? null);
    }),
  );

  /**
   * Hard remove from the fleet database. If the robot is currently online,
   * queue a factory-reset command and wait for ACK (or timeout) before DELETE.
   */
  router.post(
    "/robots/:id/decommission",
    requireAuth,
    requireRole("supervisor"),
    auditMutations,
    asyncHandler(async (req, res) => {
      const robotId = req.params.id as string;
      const { rows } = await pool.query(
        "SELECT id, name, serial FROM robots WHERE id = $1",
        [robotId],
      );
      if (rows[0] === undefined) throw notFound("robot");

      const online = (await cacheRedis.sismember(ONLINE_SET_KEY, robotId)) === 1;
      const ts = new Date().toISOString();
      const robotName = String(rows[0].name || rows[0].serial);
      await cacheRedis.set(`robot:${robotId}:ros_name`, robotName, "EX", 600);
      let factoryResetAcked = false;
      if (online) {
        await cacheRedis.del(`robot:${robotId}:factory_reset_ack`);
        await cacheRedis.set(
          `robot:${robotId}:factory_reset`,
          JSON.stringify({ action: "factory_reset", ts, reason: "decommission" }),
          "EX",
          600,
        );
        // Wait up to 15s for Pi ACK before deleting the DB row.
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline) {
          const ack = await cacheRedis.get(`robot:${robotId}:factory_reset_ack`);
          if (ack !== null) {
            factoryResetAcked = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      const del = await pool.query("DELETE FROM robots WHERE id = $1 RETURNING id", [robotId]);
      if (del.rowCount === 0) throw notFound("robot");

      await cacheRedis.srem(ONLINE_SET_KEY, robotId);
      const keys = await cacheRedis.keys(`robot:${robotId}:*`);
      const toDelete = keys.filter(
        (k) => !k.endsWith(":factory_reset") && !k.endsWith(":ros_name"),
      );
      if (toDelete.length > 0) await cacheRedis.del(...toDelete);

      // Day-1: bounce rmf-core so EasyFullControl drops the ghost robot.
      const { touchReloadFlag } = await import("../site/reload");
      await touchReloadFlag();

      await publish("registry.changed", {
        resource: "robot",
        id: robotId,
        action: "decommissioned",
        factoryResetQueued: online,
        factoryResetAcked,
      });

      res.json({
        deleted: true,
        id: robotId,
        name: rows[0].name,
        serial: rows[0].serial,
        factoryResetQueued: online,
        factoryResetAcked,
        reloadRequired: true,
        message: online
          ? factoryResetAcked
            ? "Removed. Robot ACKed factory reset (rebooting to hotspot). RMF reload requested."
            : "Removed. Factory reset queued but ACK timed out — check the Pi. RMF reload requested."
          : "Removed (robot was offline). Restart rmf-core if the adapter still lists this name.",
      });
    }),
  );

  /** Robot ACK after wiping fleet.yaml (before reboot). */
  router.post(
    "/robots/:id/factory-reset-ack",
    requireAuthOrProvisioning,
    asyncHandler(async (req, res) => {
      const robotId = req.params.id as string;
      await cacheRedis.set(
        `robot:${robotId}:factory_reset_ack`,
        JSON.stringify({ ts: new Date().toISOString() }),
        "EX",
        3600,
      );
      res.json({ ok: true });
    }),
  );

  const activateSchema = z.object({
    name: z.string().min(1).optional(),
    fleetId: z.string().uuid(),
    levelId: z.string().uuid(),
    /** Optional — set later after Building chargers exist. */
    dockWaypoint: z.string().optional(),
    homeWaypoint: z.string().optional(),
    /** When true and a home/parking waypoint is set, queue start_nav. */
    startNav: z.boolean().optional(),
  });

  /**
   * Commissioning: assign fleet/level (and optional charger/home) and mark active
   * so config-gen + navpro-rmf-adapter pick it up. Charger can be edited later.
   */
  router.post(
    "/robots/:id/activate",
    requireAuth,
    requireRole("supervisor"),
    auditMutations,
    asyncHandler(async (req, res) => {
      const robotId = req.params.id as string;
      const body = activateSchema.parse(req.body);
      const dock =
        body.dockWaypoint !== undefined && body.dockWaypoint.trim() !== ""
          ? body.dockWaypoint.trim()
          : null;
      const home =
        body.homeWaypoint !== undefined && body.homeWaypoint.trim() !== ""
          ? body.homeWaypoint.trim()
          : dock;
      const { rows } = await pool.query(
        `UPDATE robots SET
           name = COALESCE($2, name),
           fleet_id = $3,
           level_id = $4,
           dock_waypoint = COALESCE($5, dock_waypoint),
           home_waypoint = COALESCE($6, home_waypoint),
           status = 'active',
           last_seen = COALESCE(last_seen, now())
         WHERE id = $1 AND status != 'retired'
         RETURNING id, name, serial`,
        [
          robotId,
          body.name ?? null,
          body.fleetId,
          body.levelId,
          dock,
          home,
        ],
      );
      if (rows[0] === undefined) throw notFound("robot");
      const robotName = String(body.name ?? rows[0].name ?? rows[0].serial ?? "");
      if (robotName) {
        await cacheRedis.set(`robot:${robotId}:ros_name`, robotName, "EX", 86400);
      }
      await publish("registry.changed", { resource: "robot", id: robotId, action: "activated" });
      // Always claim fleet GUI occupancy for the assigned floor (no manual Pi copy).
      await pushClaimMapToRobot(robotId, body.levelId, "activated");
      const entries = await fetchGuiRobots(robotId);
      const robot = entries[0]?.robot ?? null;

      // Optional: queue start_nav when parking pose is known and startNav requested.
      const startNav = body.startNav === true;
      if (startNav && home) {
        const rmfPose = await resolveWaypointPose(body.levelId, home);
        const pose = rmfPose
          ? await rmfPoseToRobotMapPose(body.levelId, rmfPose)
          : null;
        const navPayload = {
          action: "start_nav",
          levelId: body.levelId,
          parkingWaypoint: home,
          mapName: "active",
          pose,
          ts: new Date().toISOString(),
        };
        await cacheRedis.set(`robot:${robotId}:fleet_cmd`, JSON.stringify(navPayload), "EX", 3600);
        await publish("robot.fleet.command", { robotId, ...navPayload });
      }

      res.json(robot);
    }),
  );

  const navSchema = z.object({
    action: z.enum(["start", "stop", "start_nav", "stop_nav", "set_pose", "initial_pose"]),
    parkingWaypoint: z.string().optional(),
    mapName: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    yaw: z.number().optional(),
  });

  router.post(
    "/robots/:id/nav",
    requireAuth,
    requireRole("supervisor"),
    auditMutations,
    asyncHandler(async (req, res) => {
      const robotId = req.params.id as string;
      const body = navSchema.parse(req.body);
      const { rows } = await pool.query(
        "SELECT id, name, serial, level_id, home_waypoint, dock_waypoint FROM robots WHERE id = $1",
        [robotId],
      );
      if (rows[0] === undefined) throw notFound("robot");
      const row = rows[0] as Record<string, unknown>;
      const robotName = String(row.name || row.serial);
      await cacheRedis.set(`robot:${robotId}:ros_name`, robotName, "EX", 86400);

      const levelId = typeof row.level_id === "string" ? row.level_id : null;
      const parking =
        (body.parkingWaypoint ??
          (typeof row.home_waypoint === "string" ? row.home_waypoint : null)) ||
        (typeof row.dock_waypoint === "string" ? row.dock_waypoint : null);

      // Re-localize AMCL at parking (or explicit x/y/yaw) without restarting Nav2.
      if (body.action === "set_pose" || body.action === "initial_pose") {
        let pose: { x: number; y: number; yaw: number } | null = null;
        if (
          typeof body.x === "number" &&
          typeof body.y === "number" &&
          Number.isFinite(body.x) &&
          Number.isFinite(body.y)
        ) {
          // Explicit x/y are treated as Nav2 map meters (advanced).
          pose = {
            x: body.x,
            y: body.y,
            yaw: typeof body.yaw === "number" ? body.yaw : 0,
          };
        } else if (levelId && parking) {
          const rmfPose = await resolveWaypointPose(levelId, parking);
          pose = rmfPose ? await rmfPoseToRobotMapPose(levelId, rmfPose) : null;
        }
        if (pose === null) {
          throw new HttpError(
            400,
            "set_pose needs parking/home waypoint or explicit x,y,yaw",
          );
        }
        const payload = {
          action: "set_pose",
          levelId,
          parkingWaypoint: parking,
          pose,
          x: pose.x,
          y: pose.y,
          yaw: pose.yaw,
          ts: new Date().toISOString(),
        };
        await cacheRedis.set(
          `robot:${robotId}:fleet_cmd`,
          JSON.stringify(payload),
          "EX",
          3600,
        );
        await publish("robot.fleet.command", { robotId, ...payload });
        res.json({ ok: true, ...payload });
        return;
      }

      const action =
        body.action === "start" || body.action === "start_nav"
          ? "start_nav"
          : "stop_nav";
      let pose: { x: number; y: number; yaw: number } | null = null;
      if (action === "start_nav" && levelId && parking) {
        const rmfPose = await resolveWaypointPose(levelId, parking);
        pose = rmfPose ? await rmfPoseToRobotMapPose(levelId, rmfPose) : null;
      }
      const payload = {
        action,
        levelId,
        parkingWaypoint: parking,
        mapName: body.mapName ?? "active",
        pose,
        ts: new Date().toISOString(),
      };
      await cacheRedis.set(
        `robot:${robotId}:fleet_cmd`,
        JSON.stringify(payload),
        "EX",
        3600,
      );
      await publish("robot.fleet.command", { robotId, ...payload });
      res.json({ ok: true, ...payload });
    }),
  );

  /** Parking / charger waypoints from nav graph for a level. */
  router.get(
    "/levels/:id/waypoints",
    requireAuth,
    asyncHandler(async (req, res) => {
      const levelId = req.params.id as string;
      const parkingOnly = req.query.parking === "1" || req.query.parking === "true";
      const waypoints = await listLevelWaypoints(levelId, parkingOnly);
      res.json(waypoints);
    }),
  );

  const transformSchema = z.object({ x: z.number(), y: z.number(), yaw: z.number(), scale: z.number() });

  router.put(
    "/robots/:id/transforms/:levelId",
    requireAuth,
    requireRole("supervisor"),
    auditMutations,
    asyncHandler(async (req, res) => {
      const robotId = req.params.id as string;
      const levelId = req.params.levelId as string;
      const body = transformSchema.parse(req.body);
      const { rowCount } = await pool.query(
        "UPDATE robots SET map_transform = jsonb_set(map_transform, ARRAY[$2], $3::jsonb, true) WHERE id = $1",
        [robotId, levelId, JSON.stringify(body)],
      );
      if (rowCount === 0) throw notFound("robot");
      await publish("registry.changed", { resource: "robot", id: robotId, action: "transform_updated" });
      res.json({ levelId, ...body });
    }),
  );

  // ---- levels + fleets (GUI read shapes) ----

  function mapGuiLevel(row: Record<string, unknown>): GuiLevel {
    const floorplan = typeof row.floorplan_path === "string" && row.floorplan_path !== "" ? row.floorplan_path : null;
    return {
      id: String(row.id),
      name: String(row.name),
      buildingId: typeof row.building_id === "string" ? row.building_id : "",
      imageUrl: floorplan !== null ? `/api/v1/site/files/${floorplan}` : "",
      metersPerPixel: typeof row.meters_per_pixel === "number" ? row.meters_per_pixel : 0.05,
      originX: typeof row.origin_x === "number" ? row.origin_x : 0,
      originY: typeof row.origin_y === "number" ? row.origin_y : 0,
    };
  }

  router.get(
    "/levels",
    requireAuth,
    asyncHandler(async (_req, res) => {
      const { rows } = await pool.query("SELECT * FROM levels ORDER BY name");
      res.json((rows as Record<string, unknown>[]).map(mapGuiLevel));
    }),
  );

  router.get(
    "/levels/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { rows } = await pool.query("SELECT * FROM levels WHERE id = $1", [req.params.id]);
      if (rows[0] === undefined) throw notFound("level");
      res.json(mapGuiLevel(rows[0] as Record<string, unknown>));
    }),
  );

  router.get(
    "/fleets",
    requireAuth,
    asyncHandler(async (_req, res) => {
      const { rows } = await pool.query(
        `SELECT f.id, f.name, count(r.id) FILTER (WHERE r.status != 'retired')::int AS robot_count
         FROM fleets f LEFT JOIN robots r ON r.fleet_id = f.id
         GROUP BY f.id, f.name ORDER BY f.name`,
      );
      const fleets: GuiFleet[] = (rows as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        robotCount: Number(row.robot_count ?? 0),
      }));
      res.json(fleets);
    }),
  );

  // ---- alarms ----

  router.get(
    "/alarms",
    requireAuth,
    asyncHandler(async (req, res) => {
      const activeOnly = req.query.active === "true";
      res.json(await readAlarms(activeOnly));
    }),
  );

  // ---- server info ----

  let cachedVersion: string | undefined;
  function serviceVersion(): string {
    if (cachedVersion === undefined) {
      try {
        const pkg = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8")) as {
          version?: string;
        };
        cachedVersion = pkg.version ?? "0.0.0";
      } catch {
        cachedVersion = "0.0.0";
      }
    }
    return cachedVersion;
  }

  let coordinatorCheck: { value: boolean; expiresAt: number } = { value: false, expiresAt: 0 };
  async function coordinatorReachable(): Promise<boolean> {
    const now = Date.now();
    if (now < coordinatorCheck.expiresAt) return coordinatorCheck.value;
    let reachable = false;
    try {
      // Any HTTP response (even 404) proves the coordinator is up.
      await fetch(config.rmfApiServerUrl, { signal: AbortSignal.timeout(2_000) });
      reachable = true;
    } catch {
      reachable = false;
    }
    coordinatorCheck = { value: reachable, expiresAt: now + 30_000 };
    return reachable;
  }

  router.get(
    "/server/info",
    requireAuth,
    asyncHandler(async (_req, res) => {
      const info: GuiServerInfo = {
        version: serviceVersion(),
        rmfConnected: await coordinatorReachable(),
        uptimeSeconds: Math.round(process.uptime()),
      };
      res.json(info);
    }),
  );

  // ---- mission step-level control (aliases targeting a specific step) ----

  async function loadMissionStep(missionId: string, stepId: string): Promise<{ status: string }> {
    const { rows } = await pool.query<{ status: string }>(
      "SELECT status FROM mission_steps WHERE id = $1 AND mission_id = $2",
      [stepId, missionId],
    );
    if (rows[0] === undefined) throw notFound("mission step");
    return rows[0];
  }

  async function clearMissionAlarm(missionId: string): Promise<void> {
    await cacheRedis.del(`alarms:mission:${missionId}`);
    await publish("alarm.cleared", { alarm: { id: `mission:${missionId}`, acknowledged: true } });
  }

  router.post(
    "/missions/:id/steps/:stepId/retry",
    requireAuth,
    requireRole("operator"),
    auditMutations,
    asyncHandler(async (req, res) => {
      const missionId = req.params.id as string;
      const stepId = req.params.stepId as string;
      if (isRunnerActive(missionId)) throw new HttpError(409, "mission runner is active");
      await loadMissionStep(missionId, stepId);
      await pool.query(
        "UPDATE mission_steps SET status = 'pending', attempts = 0, last_error = NULL, updated_at = now() WHERE id = $1",
        [stepId],
      );
      await clearMissionAlarm(missionId);
      startMissionRunner(missionId);
      res.json({ ok: true });
    }),
  );

  router.post(
    "/missions/:id/steps/:stepId/skip",
    requireAuth,
    requireRole("operator"),
    auditMutations,
    asyncHandler(async (req, res) => {
      const missionId = req.params.id as string;
      const stepId = req.params.stepId as string;
      if (isRunnerActive(missionId)) throw new HttpError(409, "mission runner is active");
      const step = await loadMissionStep(missionId, stepId);
      if (step.status === "done") throw new HttpError(409, "step already succeeded");
      await pool.query("UPDATE mission_steps SET status = 'skipped', updated_at = now() WHERE id = $1", [stepId]);
      await clearMissionAlarm(missionId);
      startMissionRunner(missionId);
      res.json({ ok: true });
    }),
  );

  // ---- static site files (floorplans, maps) ----

  router.get(
    "/site/files/*",
    requireAuth,
    asyncHandler(async (req, res) => {
      const rel = (req.params as Record<string, string | undefined>)["0"];
      if (rel === undefined || rel === "") throw new HttpError(400, "missing file path");
      const siteRoot = path.resolve(config.siteDir);
      const resolved = path.resolve(siteRoot, rel);
      if (resolved !== siteRoot && !resolved.startsWith(siteRoot + path.sep)) {
        throw new HttpError(403, "path escapes site directory");
      }
      await new Promise<void>((resolve, reject) => {
        res.sendFile(resolved, (err: unknown) => {
          if (err) reject(notFound("file"));
          else resolve();
        });
      });
    }),
  );

  return router;
}
