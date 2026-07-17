import { readFileSync } from "fs";
import path from "path";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config";
import { pool } from "../db/pool";
import { cacheRedis } from "../redis";
import { HttpError, asyncHandler, notFound } from "../http/errors";
import { requireAuth, requireRole, auditMutations } from "../auth/middleware";
import { publish } from "../events/bus";
import { isRunnerActive, startMissionRunner } from "../workflows/saga";
import { fetchGuiRobots } from "./robot-view";
import { readAlarms } from "./alarms";
import type { GuiFleet, GuiLevel, GuiServerInfo } from "./types";

/** GUI compat/aggregation endpoints + read overrides. Mounted before the
 *  generic registry CRUD so the enriched GET shapes shadow the raw ones.
 *  requireAuth is attached per-route (this router is mounted at /api/v1, so a
 *  router-level guard would intercept provisioning-token routes mounted later). */
export function guiRouter(): Router {
  const router = Router();

  // ---- robots (enriched reads + actions) ----

  router.get(
    "/robots",
    requireAuth,
    asyncHandler(async (_req, res) => {
      const entries = await fetchGuiRobots();
      res.json(entries.map((e) => e.robot));
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

  const activateSchema = z.object({
    name: z.string().min(1).optional(),
    fleetId: z.string().uuid(),
    levelId: z.string().uuid(),
    dockWaypoint: z.string().min(1),
    homeWaypoint: z.string().min(1).optional(),
  });

  /**
   * Commissioning: assign fleet/level/charger/home and mark the robot active
   * so config-gen + navpro-rmf-adapter pick it up for the live map.
   */
  router.post(
    "/robots/:id/activate",
    requireAuth,
    requireRole("supervisor"),
    auditMutations,
    asyncHandler(async (req, res) => {
      const robotId = req.params.id as string;
      const body = activateSchema.parse(req.body);
      const { rows } = await pool.query(
        `UPDATE robots SET
           name = COALESCE($2, name),
           fleet_id = $3,
           level_id = $4,
           dock_waypoint = $5,
           home_waypoint = COALESCE($6, home_waypoint),
           status = 'active',
           last_seen = COALESCE(last_seen, now())
         WHERE id = $1 AND status != 'retired'
         RETURNING id`,
        [
          robotId,
          body.name ?? null,
          body.fleetId,
          body.levelId,
          body.dockWaypoint,
          body.homeWaypoint ?? null,
        ],
      );
      if (rows[0] === undefined) throw notFound("robot");
      await publish("registry.changed", { resource: "robot", id: robotId, action: "activated" });
      const entries = await fetchGuiRobots(robotId);
      res.json(entries[0]?.robot ?? null);
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
