import { promises as fs } from "fs";
import path from "path";
import { Router } from "express";
import yaml from "js-yaml";
import { z } from "zod";
import { config } from "../config";
import { pool } from "../db/pool";
import { asyncHandler, HttpError, notFound } from "../http/errors";
import { requireAuth, requireRole, auditMutations } from "../auth/middleware";
import { publish } from "../events/bus";
import { generateSite } from "../config-gen/generate";
import { mapBuilding } from "../registry/mappers";
import type { BuildingGraph } from "../models";
import { logger } from "../logger";
import { cacheRedis } from "../redis";
import { verifyToken } from "../auth/jwt";
import type { NextFunction, Request, Response } from "express";

/** JWT or provisioning token (robot map upload). */
function requireAuthOrProvisioning(req: Request, _res: Response, next: NextFunction): void {
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
      /* fall through */
    }
  }
  next(new HttpError(401, "auth required"));
}
import { graphToBuildingYaml } from "./building-yaml";
import { resolveBuildingYamlPath, writeBuildingYamlFiles } from "./building-files";

function safeSiteRel(rel: string): string {
  const normalized = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new HttpError(400, "invalid path");
  }
  return normalized;
}

async function touchReloadFlag(): Promise<void> {
  const flagPath = path.join(config.siteDir, ".reload-requested");
  await fs.writeFile(flagPath, new Date().toISOString(), "utf8");
}

async function writeBuildingFromRegistry(): Promise<{ buildings: string[] }> {
  const { rows } = await pool.query("SELECT * FROM buildings ORDER BY name");
  const written: string[] = [];
  for (const row of rows as Record<string, unknown>[]) {
    const building = mapBuilding(row);
    const hasGraph =
      building.graph.waypoints.length > 0 ||
      building.graph.lanes.length > 0 ||
      building.graph.doors.length > 0 ||
      building.graph.lifts.length > 0;
    if (!hasGraph) continue;
    const yamlText = graphToBuildingYaml(building.name, building.graph);
    await writeBuildingYamlFiles(yamlText);
    written.push(building.name);
  }
  return { buildings: written };
}

async function tryGenerateNavGraphs(): Promise<{ ok: boolean; detail?: string }> {
  const buildingPath = await resolveBuildingYamlPath();
  if (buildingPath === null) {
    return { ok: false, detail: "no building.yaml / *.building.yaml" };
  }
  // Nav tools also expect *.building.yaml — sync legacy → RMF name if needed.
  if (!buildingPath.endsWith(".building.yaml")) {
    const text = await fs.readFile(buildingPath, "utf8");
    await writeBuildingYamlFiles(text);
  }
  const navBuildingPath = (await resolveBuildingYamlPath()) ?? buildingPath;
  const navOut = path.join(config.siteDir, "nav_graphs");
  await fs.mkdir(navOut, { recursive: true });
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    await execFileAsync(
      "ros2",
      ["run", "rmf_building_map_tools", "building_map_generator", "nav", navBuildingPath, navOut],
      { timeout: 120_000, env: process.env },
    );
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn("nav graph generation skipped or failed", { detail });
    return { ok: false, detail };
  }
}

export const siteRouter = Router();

siteRouter.get(
  /^\/site\/files\/(.+)$/,
  requireAuth,
  asyncHandler(async (req, res) => {
    const match = req.path.match(/^\/site\/files\/(.+)$/);
    const rel = safeSiteRel(match?.[1] ?? "");
    const abs = path.join(config.siteDir, rel);
    if (!abs.startsWith(path.resolve(config.siteDir))) throw new HttpError(400, "invalid path");
    try {
      await fs.access(abs);
    } catch {
      throw notFound("file");
    }
    res.sendFile(abs);
  }),
);

const occupancySchema = z.object({
  pgmBase64: z.string().min(1),
  yamlText: z.string().min(1),
});

siteRouter.post(
  "/levels/:id/occupancy",
  requireAuthOrProvisioning,
  auditMutations,
  asyncHandler(async (req, res) => {
    const levelId = req.params.id as string;
    const body = occupancySchema.parse(req.body);
    const pgmBuf = Buffer.from(body.pgmBase64, "base64");
    const yamlBuf = Buffer.from(body.yamlText, "utf8");

    const { rows } = await pool.query("SELECT * FROM levels WHERE id = $1", [levelId]);
    if (rows[0] === undefined) throw notFound("level");
    const levelName = String((rows[0] as Record<string, unknown>).name);

    const relDir = path.join("maps", levelName);
    await fs.mkdir(path.join(config.siteDir, relDir), { recursive: true });
    const pgmRel = path.join(relDir, "map.pgm");
    const yamlRel = path.join(relDir, "map.yaml");
    await fs.writeFile(path.join(config.siteDir, pgmRel), pgmBuf);
    await fs.writeFile(path.join(config.siteDir, yamlRel), yamlBuf);

    let metersPerPixel = 0.05;
    let originX = 0;
    let originY = 0;
    try {
      const parsed = yaml.load(body.yamlText) as Record<string, unknown>;
      if (typeof parsed.resolution === "number") metersPerPixel = parsed.resolution;
      if (Array.isArray(parsed.origin) && parsed.origin.length >= 2) {
        originX = Number(parsed.origin[0]) || 0;
        originY = Number(parsed.origin[1]) || 0;
      }
    } catch {
      /* keep defaults */
    }

    await pool.query(
      `UPDATE levels SET occupancy_map_path = $2, floorplan_path = $2,
        meters_per_pixel = $3, origin_x = $4, origin_y = $5 WHERE id = $1`,
      [levelId, pgmRel, metersPerPixel, originX, originY],
    );
    await publish("registry.changed", { resource: "level", id: levelId, action: "occupancy_uploaded" });
    res.status(201).json({
      levelId,
      occupancyMapPath: pgmRel,
      yamlPath: yamlRel,
      metersPerPixel,
      originX,
      originY,
    });
  }),
);

const importBuildingSchema = z.object({
  buildingYaml: z.string().min(1),
  buildingName: z.string().min(1).optional(),
});

siteRouter.post(
  "/site/import-building",
  requireAuth,
  requireRole("supervisor"),
  auditMutations,
  asyncHandler(async (req, res) => {
    const body = importBuildingSchema.parse(req.body);
    const yamlText = body.buildingYaml;

    let parsed: Record<string, unknown>;
    try {
      parsed = yaml.load(yamlText) as Record<string, unknown>;
    } catch (err) {
      throw new HttpError(400, `invalid YAML: ${err instanceof Error ? err.message : String(err)}`);
    }
    const name =
      (typeof parsed.name === "string" && parsed.name) || body.buildingName || "imported";

    await writeBuildingYamlFiles(yamlText);

    const { rows } = await pool.query(
      `INSERT INTO buildings (name, meta)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (name) DO UPDATE SET meta = buildings.meta || EXCLUDED.meta
       RETURNING *`,
      [name, JSON.stringify({ importedAt: new Date().toISOString(), source: "import-building" })],
    );
    const building = mapBuilding(rows[0] as Record<string, unknown>);

    const levelsObj = parsed.levels;
    if (levelsObj !== null && typeof levelsObj === "object") {
      let idx = 0;
      for (const levelName of Object.keys(levelsObj as Record<string, unknown>)) {
        await pool.query(
          `INSERT INTO levels (name, building_id, nav_graph_index)
           VALUES ($1, $2, $3)
           ON CONFLICT (building_id, name) DO NOTHING`,
          [levelName, building.id, idx],
        );
        idx += 1;
      }
    }

    const nav = await tryGenerateNavGraphs();
    await generateSite();
    await touchReloadFlag();
    await publish("site.imported", { buildingId: building.id, nav });
    res.status(201).json({ building, nav, siteGenerated: true });
  }),
);

siteRouter.post(
  "/site/materialize-building",
  requireAuth,
  requireRole("supervisor"),
  auditMutations,
  asyncHandler(async (_req, res) => {
    const buildings = await writeBuildingFromRegistry();
    const nav = await tryGenerateNavGraphs();
    const fleets = await generateSite();
    await touchReloadFlag();
    await publish("site.generated", { buildings: buildings.buildings, fleets: fleets.fleets, nav });
    res.json({ ...buildings, fleets: fleets.fleets, nav });
  }),
);

/**
 * After saving from the official traffic-editor into /site/,
 * regenerate nav graphs + fleet config from the on-disk file.
 */
siteRouter.post(
  "/site/apply-building",
  requireAuth,
  requireRole("supervisor"),
  auditMutations,
  asyncHandler(async (_req, res) => {
    let buildingPath = await resolveBuildingYamlPath();
    if (buildingPath === null) {
      throw new HttpError(404, "no building.yaml / *.building.yaml in site/");
    }
    // Ensure RMF-compatible suffix exists (traffic-editor may save building.yaml only).
    if (!buildingPath.endsWith(".building.yaml")) {
      await writeBuildingYamlFiles(await fs.readFile(buildingPath, "utf8"));
      buildingPath = (await resolveBuildingYamlPath()) ?? buildingPath;
    }

    let parsed: Record<string, unknown> = {};
    try {
      parsed = yaml.load(await fs.readFile(buildingPath, "utf8")) as Record<string, unknown>;
    } catch {
      /* ignore parse for upsert */
    }
    const name = typeof parsed.name === "string" ? parsed.name : "site";
    const { rows } = await pool.query(
      `INSERT INTO buildings (name, meta)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (name) DO UPDATE SET meta = buildings.meta || EXCLUDED.meta
       RETURNING *`,
      [name, JSON.stringify({ appliedAt: new Date().toISOString(), source: "traffic-editor" })],
    );
    const building = mapBuilding(rows[0] as Record<string, unknown>);
    const levelsObj = parsed.levels;
    if (levelsObj !== null && typeof levelsObj === "object") {
      let idx = 0;
      for (const levelName of Object.keys(levelsObj as Record<string, unknown>)) {
        await pool.query(
          `INSERT INTO levels (name, building_id, nav_graph_index)
           VALUES ($1, $2, $3)
           ON CONFLICT (building_id, name) DO NOTHING`,
          [levelName, building.id, idx],
        );
        idx += 1;
      }
    }

    const nav = await tryGenerateNavGraphs();
    const fleets = await generateSite();
    await touchReloadFlag();
    await publish("site.applied", { buildingId: building.id, nav, fleets: fleets.fleets });
    res.json({ building, nav, fleets: fleets.fleets });
  }),
);

siteRouter.post(
  "/buildings/:id/graph",
  requireAuth,
  requireRole("supervisor"),
  auditMutations,
  asyncHandler(async (req, res) => {
    const buildingId = req.params.id as string;
    const graph = req.body as BuildingGraph;
    if (graph === null || typeof graph !== "object") throw new HttpError(400, "graph body required");
    const { rows } = await pool.query(`UPDATE buildings SET graph = $2::jsonb WHERE id = $1 RETURNING *`, [
      buildingId,
      JSON.stringify(graph),
    ]);
    if (rows[0] === undefined) throw notFound("building");
    const building = mapBuilding(rows[0] as Record<string, unknown>);
    await writeBuildingFromRegistry();
    const nav = await tryGenerateNavGraphs();
    await generateSite();
    await touchReloadFlag();
    await publish("registry.changed", { resource: "building", id: buildingId, action: "graph_updated" });
    res.json({ building, nav });
  }),
);

siteRouter.get(
  "/buildings/:id/graph",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM buildings WHERE id = $1", [req.params.id]);
    if (rows[0] === undefined) throw notFound("building");
    res.json(mapBuilding(rows[0] as Record<string, unknown>).graph);
  }),
);

siteRouter.post(
  "/robots/:id/mapping",
  requireAuth,
  requireRole("supervisor"),
  auditMutations,
  asyncHandler(async (req, res) => {
    const robotId = req.params.id as string;
    const action = z.enum(["start", "stop", "save"]).parse(req.body?.action);
    const { rowCount } = await pool.query("SELECT 1 FROM robots WHERE id = $1", [robotId]);
    if (rowCount === 0) throw notFound("robot");
    await publish("robot.mapping.command", { robotId, action, ts: new Date().toISOString() });
    await cacheRedis.set(
      `robot:${robotId}:mapping_cmd`,
      JSON.stringify({ action, ts: new Date().toISOString() }),
      "EX",
      3600,
    );
    res.json({ robotId, action, queued: true });
  }),
);
