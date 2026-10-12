import { Router } from "express";
import { pool } from "../db/pool";
import { asyncHandler } from "../http/errors";
import { requireAuth } from "../auth/middleware";

// MINIMAL analytics stub. Full analytics (utilization, battery history,
// charging stats, traffic heatmaps, exportable reports) is deliberately
// deferred per the platform plan: it is demand-driven and will be built when
// a customer asks for it, on top of the same missions/health_history tables.
export const analyticsRouter = Router();

analyticsRouter.get(
  "/summary",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const [missions, health] = await Promise.all([
      pool.query<{ status: string; count: string }>(
        "SELECT status, count(*)::text AS count FROM missions GROUP BY status",
      ),
      pool.query<{ robots: string; samples: string }>(
        "SELECT count(DISTINCT robot_id)::text AS robots, count(*)::text AS samples FROM health_history WHERE ts > now() - interval '24 hours'",
      ),
    ]);
    res.json({
      missionsByStatus: Object.fromEntries(missions.rows.map((r) => [r.status, Number(r.count)])),
      last24h: {
        robotsReporting: Number(health.rows[0]?.robots ?? 0),
        healthSamples: Number(health.rows[0]?.samples ?? 0),
      },
    });
  }),
);
