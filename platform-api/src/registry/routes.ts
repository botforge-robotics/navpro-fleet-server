import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { asyncHandler, notFound } from "../http/errors";
import { requireAuth, requireRole, auditMutations } from "../auth/middleware";
import { publish } from "../events/bus";
import { mapBuilding, mapDevice, mapFleet, mapLevel, mapRobot } from "./mappers";
import { buildPatch } from "./sql";
import { registerRouter } from "./register";

const mapTransformSchema = z.record(
  z.string(),
  z.object({ x: z.number(), y: z.number(), yaw: z.number(), scale: z.number() }),
);

// Site regeneration is event-driven: the config-gen consumer group reacts to
// registry.changed events (see index.ts), so emitting the event is enough.
async function emitRegistryChanged(resource: string, id: string, action: string): Promise<void> {
  await publish("registry.changed", { resource, id, action });
}

interface CrudSpec {
  table: string;
  resource: string;
  createSchema: z.ZodTypeAny;
  updateSchema: z.ZodTypeAny;
  columnMap: Record<string, string>;
  jsonColumns: readonly string[];
  map: (row: Record<string, unknown>) => unknown;
  /** Registry changes that feed generated RMF config trigger regeneration. */
  affectsRmfConfig: boolean;
}

function crudRouter(spec: CrudSpec): Router {
  const router = Router();
  const write: RequestHandler[] = [requireRole("supervisor"), auditMutations];

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const { rows } = await pool.query(`SELECT * FROM ${spec.table} ORDER BY 1`);
      res.json(rows.map(spec.map));
    }),
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const { rows } = await pool.query(`SELECT * FROM ${spec.table} WHERE id = $1`, [req.params.id]);
      if (rows[0] === undefined) throw notFound(spec.resource);
      res.json(spec.map(rows[0]));
    }),
  );

  router.post(
    "/",
    ...write,
    asyncHandler(async (req, res) => {
      const body = spec.createSchema.parse(req.body) as Record<string, unknown>;
      const columns: string[] = [];
      const values: unknown[] = [];
      for (const [key, column] of Object.entries(spec.columnMap)) {
        if (!(key in body) || body[key] === undefined) continue;
        columns.push(column);
        values.push(spec.jsonColumns.includes(column) ? JSON.stringify(body[key]) : body[key]);
      }
      const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await pool.query(
        `INSERT INTO ${spec.table} (${columns.join(", ")}) VALUES (${placeholders}) RETURNING *`,
        values,
      );
      const row = rows[0] as Record<string, unknown>;
      if (spec.affectsRmfConfig) await emitRegistryChanged(spec.resource, String(row.id), "created");
      res.status(201).json(spec.map(row));
    }),
  );

  router.patch(
    "/:id",
    ...write,
    asyncHandler(async (req, res) => {
      const body = spec.updateSchema.parse(req.body) as Record<string, unknown>;
      const query = buildPatch(spec.table, req.params.id as string, body, spec.columnMap, spec.jsonColumns);
      const { rows } = await pool.query(query.text, query.values);
      if (rows[0] === undefined) throw notFound(spec.resource);
      if (spec.affectsRmfConfig) await emitRegistryChanged(spec.resource, req.params.id as string, "updated");
      res.json(spec.map(rows[0] as Record<string, unknown>));
    }),
  );

  router.delete(
    "/:id",
    ...write,
    asyncHandler(async (req, res) => {
      const { rowCount } = await pool.query(`DELETE FROM ${spec.table} WHERE id = $1`, [req.params.id]);
      if (rowCount === 0) throw notFound(spec.resource);
      if (spec.affectsRmfConfig) await emitRegistryChanged(spec.resource, req.params.id as string, "deleted");
      res.status(204).end();
    }),
  );

  return router;
}

const robotCreate = z.object({
  serial: z.string().min(1),
  name: z.string().optional(),
  fleetId: z.string().uuid().optional(),
  mac: z.string().optional(),
  wifiSsid: z.string().optional(),
  levelId: z.string().uuid().optional(),
  batterySpec: z.record(z.string(), z.unknown()).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  dockWaypoint: z.string().optional(),
  homeWaypoint: z.string().optional(),
  firmwareVersion: z.string().optional(),
  piVersion: z.string().optional(),
  configVersion: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  mapTransform: mapTransformSchema.optional(),
  status: z.enum(["unprovisioned", "active", "maintenance", "retired"]).optional(),
});

const robotColumns: Record<string, string> = {
  serial: "serial",
  name: "name",
  fleetId: "fleet_id",
  mac: "mac",
  wifiSsid: "wifi_ssid",
  levelId: "level_id",
  batterySpec: "battery_spec",
  payload: "payload",
  dockWaypoint: "dock_waypoint",
  homeWaypoint: "home_waypoint",
  firmwareVersion: "firmware_version",
  piVersion: "pi_version",
  configVersion: "config_version",
  capabilities: "capabilities",
  mapTransform: "map_transform",
  status: "status",
};

const fleetCreate = z.object({
  name: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(["active", "reloading"]).optional(),
});

const levelCreate = z.object({
  name: z.string().min(1),
  buildingId: z.string().uuid().optional(),
  floorplanPath: z.string().optional(),
  occupancyMapPath: z.string().optional(),
  navGraphIndex: z.number().int().optional(),
  elevation: z.number().optional(),
  metersPerPixel: z.number().positive().optional(),
  originX: z.number().optional(),
  originY: z.number().optional(),
});

const buildingGraphSchema = z.object({
  waypoints: z.array(z.record(z.string(), z.unknown())).default([]),
  lanes: z.array(z.record(z.string(), z.unknown())).default([]),
  doors: z.array(z.record(z.string(), z.unknown())).default([]),
  lifts: z.array(z.record(z.string(), z.unknown())).default([]),
});

const buildingCreate = z.object({
  name: z.string().min(1),
  meta: z.record(z.string(), z.unknown()).optional(),
  graph: buildingGraphSchema.optional(),
});

const deviceCreate = z.object({
  name: z.string().min(1),
  type: z.enum(["door", "lift", "dispenser", "dock", "plc", "camera", "custom"]),
  plugin: z.string().min(1),
  levelId: z.string().uuid().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

export const robotsCrudRouter = crudRouter({
  table: "robots",
  resource: "robot",
  createSchema: robotCreate,
  updateSchema: robotCreate.partial(),
  columnMap: robotColumns,
  jsonColumns: ["battery_spec", "payload", "capabilities", "map_transform"],
  map: mapRobot,
  affectsRmfConfig: true,
});

export const fleetsCrudRouter = crudRouter({
  table: "fleets",
  resource: "fleet",
  createSchema: fleetCreate,
  updateSchema: fleetCreate.partial(),
  columnMap: { name: "name", config: "config", status: "status" },
  jsonColumns: ["config"],
  map: mapFleet,
  affectsRmfConfig: true,
});

export const levelsCrudRouter = crudRouter({
  table: "levels",
  resource: "level",
  createSchema: levelCreate,
  updateSchema: levelCreate.partial(),
  columnMap: {
    name: "name",
    buildingId: "building_id",
    floorplanPath: "floorplan_path",
    occupancyMapPath: "occupancy_map_path",
    navGraphIndex: "nav_graph_index",
    elevation: "elevation",
    metersPerPixel: "meters_per_pixel",
    originX: "origin_x",
    originY: "origin_y",
  },
  jsonColumns: [],
  map: mapLevel,
  affectsRmfConfig: true,
});

export const buildingsCrudRouter = crudRouter({
  table: "buildings",
  resource: "building",
  createSchema: buildingCreate,
  updateSchema: buildingCreate.partial(),
  columnMap: { name: "name", meta: "meta", graph: "graph" },
  jsonColumns: ["meta", "graph"],
  map: mapBuilding,
  affectsRmfConfig: true,
});

export const devicesCrudRouter = crudRouter({
  table: "devices",
  resource: "device",
  createSchema: deviceCreate,
  updateSchema: deviceCreate.partial(),
  columnMap: {
    name: "name",
    type: "type",
    plugin: "plugin",
    levelId: "level_id",
    config: "config",
    enabled: "enabled",
  },
  jsonColumns: ["config"],
  map: mapDevice,
  affectsRmfConfig: false,
});

/** Aggregates all registry routes under /api/v1. */
export function registryRouter(): Router {
  const router = Router();
  // Self-registration authenticates with the provisioning token, not a JWT,
  // so it must be mounted before the requireAuth guard.
  router.use("/robots", registerRouter);
  router.use("/robots", requireAuth, robotsCrudRouter);
  router.use("/fleets", requireAuth, fleetsCrudRouter);
  router.use("/levels", requireAuth, levelsCrudRouter);
  router.use("/buildings", requireAuth, buildingsCrudRouter);
  router.use("/devices", requireAuth, devicesCrudRouter);
  return router;
}
