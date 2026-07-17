import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { config } from "../config";
import { pool } from "../db/pool";
import { cacheRedis } from "../redis";
import { HttpError, asyncHandler, notFound } from "../http/errors";
import { verifyToken } from "../auth/jwt";
import { requireAuth } from "../auth/middleware";
import { publish } from "../events/bus";

const HEALTH_TTL_SECONDS = 10;
const HISTORY_SAMPLE_SECONDS = 10;
export const ONLINE_SET_KEY = "robots:online";

const heartbeatSchema = z.object({
  pose: z.object({ x: z.number(), y: z.number(), yaw: z.number(), levelName: z.string().optional() }).optional(),
  mode: z.string().optional(),
  taskId: z.string().optional(),
  cpu: z.number().optional(),
  mem: z.number().optional(),
  temp: z.number().optional(),
  disk: z.number().optional(),
  wifiRssi: z.number().optional(),
  batterySoc: z.number().optional(),
  motorFault: z.boolean().optional(),
  estop: z.boolean().optional(),
  lidarOk: z.boolean().optional(),
  cameraOk: z.boolean().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

/** Heartbeats are accepted with the provisioning token (robot-side) or any valid JWT. */
function requireRobotAuth(req: Request, _res: Response, next: NextFunction): void {
  if (req.header("X-Provisioning-Token") === config.provisioningToken) {
    next();
    return;
  }
  const header = req.headers.authorization;
  if (header !== undefined && header.startsWith("Bearer ")) {
    try {
      req.auth = verifyToken(header.slice("Bearer ".length));
      next();
      return;
    } catch {
      // fall through
    }
  }
  next(new HttpError(401, "heartbeat requires provisioning token or valid JWT"));
}

export const heartbeatRouter = Router();

heartbeatRouter.post(
  "/robots/:id/heartbeat",
  requireRobotAuth,
  asyncHandler(async (req, res) => {
    const robotId = req.params.id as string;
    const body = heartbeatSchema.parse(req.body);
    const ts = new Date().toISOString();

    const { rowCount } = await pool.query("UPDATE robots SET last_seen = now() WHERE id = $1", [robotId]);
    if (rowCount === 0) throw notFound("robot");

    const health = { robotId, ts, ...body };
    const state = { robotId, ts, pose: body.pose, mode: body.mode, batterySoc: body.batterySoc, taskId: body.taskId };
    await cacheRedis.set(`robot:${robotId}:health`, JSON.stringify(health), "EX", HEALTH_TTL_SECONDS);
    await cacheRedis.set(`robot:${robotId}:state`, JSON.stringify(state), "EX", HEALTH_TTL_SECONDS);

    // Online transition: SADD returns 1 only when the robot was not in the set.
    const added = await cacheRedis.sadd(ONLINE_SET_KEY, robotId);
    if (added === 1) await publish("robot.online", { robotId });

    // Durable history, sampled to at most one row per robot per 10s.
    const sampleGate = await cacheRedis.set(`robot:${robotId}:health:sampled`, "1", "EX", HISTORY_SAMPLE_SECONDS, "NX");
    if (sampleGate === "OK") {
      await pool.query(
        `INSERT INTO health_history
           (robot_id, cpu, mem, temp, disk, wifi_rssi, battery_soc, motor_fault, estop, lidar_ok, camera_ok, extra)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          robotId,
          body.cpu ?? null,
          body.mem ?? null,
          body.temp ?? null,
          body.disk ?? null,
          body.wifiRssi ?? null,
          body.batterySoc ?? null,
          body.motorFault ?? null,
          body.estop ?? null,
          body.lidarOk ?? null,
          body.cameraOk ?? null,
          JSON.stringify(body.extra ?? {}),
        ],
      );
      if (body.pose !== undefined || body.mode !== undefined) {
        await pool.query(
          "INSERT INTO robot_state_history (robot_id, pose, mode, battery_soc, task_id) VALUES ($1, $2, $3, $4, $5)",
          [robotId, body.pose !== undefined ? JSON.stringify(body.pose) : null, body.mode ?? null, body.batterySoc ?? null, body.taskId ?? null],
        );
      }
    }

    res.json({ ok: true });
  }),
);

heartbeatRouter.get(
  "/robots/:id/mapping-cmd",
  requireRobotAuth,
  asyncHandler(async (req, res) => {
    const robotId = req.params.id as string;
    const raw = await cacheRedis.get(`robot:${robotId}:mapping_cmd`);
    res.json(raw !== null ? JSON.parse(raw) : null);
  }),
);

// requireAuth is attached per-route (not via router.use) because this router
// is mounted at /api/v1 alongside provisioning-token routes; a router-level
// guard would intercept unrelated paths.
export const healthQueryRouter = Router();

const HISTORY_LIMIT = 500;

/** GUI HealthSample[]: most recent samples in ascending time order. */
healthQueryRouter.get(
  "/robots/:id/health",
  requireAuth,
  asyncHandler(async (req, res) => {
    const robotId = req.params.id as string;
    const { rows } = await pool.query(
      `SELECT * FROM (
         SELECT robot_id, ts, cpu, temp, wifi_rssi, battery_soc, estop, extra
         FROM health_history WHERE robot_id = $1 ORDER BY ts DESC LIMIT $2
       ) recent ORDER BY ts ASC`,
      [robotId, HISTORY_LIMIT],
    );
    const samples = (rows as Record<string, unknown>[]).map((row) => {
      const soc = typeof row.battery_soc === "number" ? row.battery_soc : null;
      const extra = row.extra !== null && typeof row.extra === "object" ? (row.extra as Record<string, unknown>) : {};
      return {
        robotId: row.robot_id,
        timestamp: row.ts instanceof Date ? row.ts.toISOString() : row.ts,
        batteryPercent: soc === null ? null : soc <= 1 ? Math.round(soc * 1000) / 10 : soc,
        wifiRssi: typeof row.wifi_rssi === "number" ? row.wifi_rssi : null,
        cpuTempC: typeof row.temp === "number" ? row.temp : null,
        batteryTempC: typeof extra.batteryTempC === "number" ? extra.batteryTempC : null,
        cpuLoad: typeof row.cpu === "number" ? row.cpu : null,
        estop: row.estop === true,
      };
    });
    res.json(samples);
  }),
);

healthQueryRouter.get(
  "/fleet/health",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query<{ id: string; name: string | null; serial: string; fleet_id: string | null }>(
      "SELECT id, name, serial, fleet_id FROM robots WHERE status = 'active'",
    );
    const online = new Set(await cacheRedis.smembers(ONLINE_SET_KEY));
    const robots = await Promise.all(
      rows.map(async (robot) => {
        const cached = await cacheRedis.get(`robot:${robot.id}:health`);
        return {
          robotId: robot.id,
          name: robot.name ?? robot.serial,
          fleetId: robot.fleet_id,
          online: online.has(robot.id),
          health: cached !== null ? (JSON.parse(cached) as Record<string, unknown>) : null,
        };
      }),
    );
    res.json({ total: robots.length, online: robots.filter((r) => r.online).length, robots });
  }),
);
