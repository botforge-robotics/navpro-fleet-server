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
import {
  encodeGrayPng,
  encodePgm,
  parsePgm,
  pgmToPng,
  resizeGrayNearest,
} from "./pgm-to-png";
import { upsertLevelScaleFromResolution } from "./level-scale";
import { touchReloadFlag, touchTrafficEditorReload } from "./reload";
import { hashOccupancyFiles, pushClaimMapToLevelRobots } from "./map-sync";

/** Fleet occupancy always stored as map.pgm + origin [0,0,0] for traffic-editor. */
function normalizeOccupancyYaml(yamlText: string): {
  yamlText: string;
  metersPerPixel: number;
} {
  let metersPerPixel = 0.05;
  let parsed: Record<string, unknown> = {};
  try {
    const loaded = yaml.load(yamlText);
    if (loaded && typeof loaded === "object" && !Array.isArray(loaded)) {
      parsed = loaded as Record<string, unknown>;
    }
  } catch {
    /* rewrite defaults below */
  }
  if (
    typeof parsed.resolution === "number" &&
    Number.isFinite(parsed.resolution)
  ) {
    metersPerPixel = parsed.resolution;
  }
  parsed.image = "map.pgm";
  parsed.origin = [0, 0, 0];
  if (parsed.mode === undefined) parsed.mode = "trinary";
  if (parsed.negate === undefined) parsed.negate = 0;
  if (parsed.occupied_thresh === undefined) parsed.occupied_thresh = 0.65;
  if (parsed.free_thresh === undefined) parsed.free_thresh = 0.25;
  return {
    yamlText: yaml.dump(parsed, { lineWidth: -1, noRefs: true }),
    metersPerPixel,
  };
}

/** JWT or provisioning token (robot map upload). */
function requireAuthOrProvisioning(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
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
import {
  resolveBuildingYamlPath,
  writeBuildingYamlFiles,
} from "./building-files";

function safeSiteRel(rel: string): string {
  const normalized = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new HttpError(400, "invalid path");
  }
  return normalized;
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

async function tryGenerateNavGraphs(): Promise<{
  ok: boolean;
  detail?: string;
}> {
  const buildingPath = await resolveBuildingYamlPath();
  if (buildingPath === null) {
    return { ok: false, detail: "no building.yaml / *.building.yaml" };
  }
  // Nav tools also expect *.building.yaml — sync legacy → RMF name if needed.
  if (!buildingPath.endsWith(".building.yaml")) {
    const text = await fs.readFile(buildingPath, "utf8");
    await writeBuildingYamlFiles(text);
  }
  const navOut = path.join(config.siteDir, "nav_graphs");
  await fs.mkdir(navOut, { recursive: true });

  // platform-api image has no ROS. Ask traffic-editor (shared /site) to run
  // building_map_generator, then wait for the done stamp.
  const token = `${Date.now()}`;
  const reqPath = path.join(config.siteDir, ".nav-graph-rebuild");
  const donePath = path.join(config.siteDir, ".nav-graph-done");
  try {
    try {
      await fs.unlink(donePath);
    } catch {
      /* optional */
    }
    await fs.writeFile(reqPath, `${token}\n`, "utf8");

    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      try {
        const done = (await fs.readFile(donePath, "utf8")).trim();
        if (done.startsWith(`ok:${token}`)) {
          return { ok: true };
        }
        if (done.startsWith("error:")) {
          return {
            ok: false,
            detail: done.slice("error:".length).trim() || "generator failed",
          };
        }
      } catch {
        /* not ready */
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    return {
      ok: false,
      detail:
        "timed out waiting for traffic-editor nav graph generator (is traffic-editor running?)",
    };
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
    if (!abs.startsWith(path.resolve(config.siteDir)))
      throw new HttpError(400, "invalid path");
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

    const { rows } = await pool.query("SELECT * FROM levels WHERE id = $1", [
      levelId,
    ]);
    if (rows[0] === undefined) throw notFound("level");
    const levelName = String((rows[0] as Record<string, unknown>).name);

    const relDir = path.join("maps", levelName);
    await fs.mkdir(path.join(config.siteDir, relDir), { recursive: true });
    const pgmRel = path.join(relDir, "map.pgm");
    const yamlRel = path.join(relDir, "map.yaml");
    const floorplanRel = path.join(relDir, "floorplan.png");
    const { yamlText: normalizedYaml, metersPerPixel } = normalizeOccupancyYaml(
      body.yamlText,
    );
    // Fleet frame: bottom-left of image is world (0,0) — drop SLAM origin.
    const originX = 0;
    const originY = 0;
    await fs.writeFile(path.join(config.siteDir, pgmRel), pgmBuf);
    await fs.writeFile(
      path.join(config.siteDir, yamlRel),
      normalizedYaml,
      "utf8",
    );
    try {
      const png = pgmToPng(pgmBuf);
      await fs.writeFile(path.join(config.siteDir, floorplanRel), png);
    } catch (err) {
      logger.warn("occupancy floorplan.png convert failed", {
        levelId,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    await pool.query(
      `UPDATE levels SET occupancy_map_path = $2, floorplan_path = $3,
        meters_per_pixel = $4, origin_x = $5, origin_y = $6 WHERE id = $1`,
      [levelId, pgmRel, floorplanRel, metersPerPixel, originX, originY],
    );

    // Keep traffic-editor level scale in sync with map.yaml resolution.
    try {
      const buildingPath = await resolveBuildingYamlPath();
      if (buildingPath) {
        const text = await fs.readFile(buildingPath, "utf8");
        const doc = yaml.load(text) as Record<string, unknown> | null;
        if (doc && typeof doc === "object") {
          const levels = doc.levels as
            | Record<string, Record<string, unknown>>
            | undefined;
          if (levels?.[levelName]) {
            levels[levelName].drawing = {
              filename: floorplanRel.replace(/\\/g, "/"),
            };
            let navW = 100;
            try {
              navW = parsePgm(pgmBuf).width;
            } catch {
              /* keep default span */
            }
            upsertLevelScaleFromResolution(
              levels[levelName],
              metersPerPixel,
              navW,
            );
            await fs.writeFile(
              buildingPath,
              yaml.dump(doc, { lineWidth: -1, noRefs: true }),
              "utf8",
            );
          }
        }
      }
      await touchTrafficEditorReload();
    } catch (err) {
      logger.warn("occupancy building scale update skipped", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
    await publish("registry.changed", {
      resource: "level",
      id: levelId,
      action: "occupancy_uploaded",
    });
    // Every robot on this floor re-claims GUI occupancy (origin/yaml/pgm).
    await pushClaimMapToLevelRobots(levelId, "occupancy_uploaded");
    res.status(201).json({
      levelId,
      occupancyMapPath: pgmRel,
      yamlPath: yamlRel,
      floorplanPath: floorplanRel,
      metersPerPixel,
      originX,
      originY,
    });
  }),
);

/**
 * GUI map cleanup editor: hi-res edit canvas → Nav2 PGM + RMF floorplan PNG
 * at the same nav size and map.yaml resolution (no PNG upscale).
 * Edit-time upscale is UI-only for brush precision.
 */
const mapEditSchema = z.object({
  width: z.number().int().positive().max(8192),
  height: z.number().int().positive().max(8192),
  /** Row-major grayscale 0–255 at edit (hi-res) size. */
  pixelsBase64: z.string().min(1),
  /** Ignored: floorplan is always saved at nav size (same as PGM). Kept for API compat. */
  jpgBase64: z.string().optional(),
  /** Integer upscale used while editing (e.g. 5). Nav PGM is width/editScale. */
  editScale: z.number().int().positive().max(16).default(1),
  /** Nav2 PGM size (defaults to width/editScale). */
  navWidth: z.number().int().positive().max(8192).optional(),
  navHeight: z.number().int().positive().max(8192).optional(),
  resolution: z.number().positive().optional(),
  originX: z.number().optional(),
  originY: z.number().optional(),
});

siteRouter.put(
  "/levels/:id/map-edit",
  requireAuth,
  auditMutations,
  asyncHandler(async (req, res) => {
    const levelId = req.params.id as string;
    const body = mapEditSchema.parse(req.body);
    const { rows } = await pool.query("SELECT * FROM levels WHERE id = $1", [
      levelId,
    ]);
    if (rows[0] === undefined) throw notFound("level");
    const row = rows[0] as Record<string, unknown>;
    const levelName = String(row.name);

    const editW = body.width;
    const editH = body.height;
    const editScale = Math.max(1, body.editScale || 1);
    const pixels = Buffer.from(body.pixelsBase64, "base64");
    const need = editW * editH;
    if (pixels.length < need) {
      throw new HttpError(400, `pixels length ${pixels.length} < ${need}`);
    }

    // Nav2 resolution comes from map.yaml only (DB meters_per_pixel may be floorplan scale).
    // Origin is always [0,0,0] for every level (no SLAM/per-map hardcoded origins).
    const relDir = path.join("maps", levelName);
    const yamlRel = path.join(relDir, "map.yaml");
    let navResolution = 0.05;
    const originX = 0;
    const originY = 0;
    let freeThresh = 0.25;
    let occupiedThresh = 0.65;
    try {
      const existingYaml = await fs.readFile(
        path.join(config.siteDir, yamlRel),
        "utf8",
      );
      const parsed = yaml.load(existingYaml) as Record<string, unknown> | null;
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.resolution === "number" && parsed.resolution > 0) {
          navResolution = parsed.resolution;
        }
        if (typeof parsed.free_thresh === "number")
          freeThresh = parsed.free_thresh;
        if (typeof parsed.occupied_thresh === "number") {
          occupiedThresh = parsed.occupied_thresh;
        }
      }
    } catch {
      if (typeof body.resolution === "number" && body.resolution > 0) {
        navResolution = body.resolution;
      }
    }

    // Always preserve edit aspect ratio. Forcing old navW×navH after a rotation
    // (or crop) stretches the map — that was the "skewed after save" bug.
    const derivedNavW = Math.max(1, Math.round(editW / editScale));
    const derivedNavH = Math.max(1, Math.round(editH / editScale));
    let navW = body.navWidth ?? derivedNavW;
    let navH = body.navHeight ?? derivedNavH;
    const editAspect = editW / Math.max(1, editH);
    const navAspect = navW / Math.max(1, navH);
    if (Math.abs(editAspect - navAspect) > 0.02 * editAspect) {
      navW = derivedNavW;
      navH = derivedNavH;
    }
    if (navW > editW || navH > editH) {
      throw new HttpError(400, "nav size cannot exceed edit size");
    }

    const grayEdit = pixels.subarray(0, need);
    // Keep trinary occupancy (0 / 205 / 255) in Nav2 PGM so reload matches
    // floorplan.png. Unknown must stay unknown — remapping to free skewed the
    // editor view vs the saved PNG.
    const grayNav =
      navW === editW && navH === editH
        ? Buffer.from(grayEdit)
        : resizeGrayNearest(Buffer.from(grayEdit), editW, editH, navW, navH);

    // Floorplan must match PGM size + map.yaml resolution. Traffic-editor scale
    // is set from yaml (e.g. 0.05 m/px); a 5× PNG made measurements ~5× too large.
    const floorplanMetersPerPixel = navResolution;

    await fs.mkdir(path.join(config.siteDir, relDir), { recursive: true });
    const pgmRel = path.join(relDir, "map.pgm");
    const pngRel = path.join(relDir, "floorplan.png");
    const jpgRel = path.join(relDir, "floorplan.jpg");

    const pgmBuf = encodePgm(navW, navH, grayNav);
    const pngBuf = encodeGrayPng(navW, navH, grayNav);
    const yamlText = yaml.dump(
      {
        image: "map.pgm",
        mode: "trinary",
        resolution: navResolution,
        origin: [originX, originY, 0],
        negate: 0,
        occupied_thresh: occupiedThresh,
        free_thresh: freeThresh,
      },
      { lineWidth: -1, noRefs: true },
    );

    await fs.writeFile(path.join(config.siteDir, pgmRel), pgmBuf);
    await fs.writeFile(path.join(config.siteDir, yamlRel), yamlText, "utf8");
    await fs.writeFile(path.join(config.siteDir, pngRel), pngBuf);
    // Drop stale hi-res JPG from older saves (PNG is the drawing source of truth).
    try {
      await fs.unlink(path.join(config.siteDir, jpgRel));
    } catch {
      /* optional */
    }

    const floorplanRel = pngRel;
    await pool.query(
      `UPDATE levels SET occupancy_map_path = $2, floorplan_path = $3,
        meters_per_pixel = $4, origin_x = $5, origin_y = $6 WHERE id = $1`,
      [
        levelId,
        pgmRel,
        floorplanRel,
        floorplanMetersPerPixel,
        originX,
        originY,
      ],
    );

    try {
      const buildingPath = await resolveBuildingYamlPath();
      if (buildingPath) {
        const text = await fs.readFile(buildingPath, "utf8");
        const doc = yaml.load(text) as Record<string, unknown> | null;
        if (doc && typeof doc === "object") {
          const levels = doc.levels as
            | Record<string, Record<string, unknown>>
            | undefined;
          if (levels?.[levelName]) {
            levels[levelName].drawing = {
              filename: floorplanRel.replace(/\\/g, "/"),
            };
            // Traffic-editor scale comes from measurements, not map.yaml —
            // inject a measurement so level opens at yaml resolution (e.g. 0.05).
            upsertLevelScaleFromResolution(
              levels[levelName],
              navResolution,
              navW,
            );
            await fs.writeFile(
              buildingPath,
              yaml.dump(doc, { lineWidth: -1, noRefs: true }),
              "utf8",
            );
          }
        }
      }
    } catch (err) {
      logger.warn("map-edit building drawing update skipped", {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    // Force traffic-editor Qt process to relaunch and pick up new floorplan.png
    // (same path is cached in memory otherwise → stale drawing).
    try {
      await touchTrafficEditorReload();
    } catch (err) {
      logger.warn("map-edit traffic-editor reload flag failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    await publish("registry.changed", {
      resource: "level",
      id: levelId,
      action: "map_edited",
    });
    await pushClaimMapToLevelRobots(levelId, "map_edited");
    res.json({
      levelId,
      occupancyMapPath: pgmRel,
      yamlPath: yamlRel,
      floorplanPath: floorplanRel,
      floorplanJpgPath: null,
      navResolution,
      floorplanMetersPerPixel,
      metersPerPixel: floorplanMetersPerPixel,
      originX,
      originY,
      editWidth: editW,
      editHeight: editH,
      navWidth: navW,
      navHeight: navH,
      editScale,
      width: navW,
      height: navH,
      trafficEditorReload: true,
    });
  }),
);

/** Robot claim: download occupancy PGM + YAML (provisioning token or JWT). */
siteRouter.get(
  "/levels/:id/occupancy",
  requireAuthOrProvisioning,
  asyncHandler(async (req, res) => {
    const levelId = req.params.id as string;
    const { rows } = await pool.query("SELECT * FROM levels WHERE id = $1", [
      levelId,
    ]);
    if (rows[0] === undefined) throw notFound("level");
    const row = rows[0] as Record<string, unknown>;
    const levelName = String(row.name);
    const pgmRel =
      typeof row.occupancy_map_path === "string" &&
      row.occupancy_map_path.length > 0
        ? row.occupancy_map_path
        : path.join("maps", levelName, "map.pgm");
    const yamlRel = pgmRel.replace(/\.pgm$/i, ".yaml");
    const pgmAbs = path.join(config.siteDir, pgmRel);
    const yamlAbs = path.join(config.siteDir, yamlRel);
    try {
      await fs.access(pgmAbs);
      await fs.access(yamlAbs);
    } catch {
      throw notFound("occupancy");
    }
    const pgmBuf = await fs.readFile(pgmAbs);
    const yamlText = await fs.readFile(yamlAbs, "utf8");
    const mapRevision = await hashOccupancyFiles(pgmAbs, yamlAbs);
    let metersPerPixel =
      typeof row.meters_per_pixel === "number" ? row.meters_per_pixel : 0.05;
    let originX = typeof row.origin_x === "number" ? row.origin_x : 0;
    let originY = typeof row.origin_y === "number" ? row.origin_y : 0;
    try {
      const parsed = yaml.load(yamlText) as Record<string, unknown> | null;
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.resolution === "number" && parsed.resolution > 0) {
          metersPerPixel = parsed.resolution;
        }
        if (Array.isArray(parsed.origin) && parsed.origin.length >= 2) {
          originX = Number(parsed.origin[0]) || 0;
          originY = Number(parsed.origin[1]) || 0;
        }
      }
    } catch {
      /* keep DB */
    }
    res.json({
      levelId,
      levelName,
      mapName: "active",
      mapRevision,
      pgmBase64: pgmBuf.toString("base64"),
      yamlText,
      metersPerPixel,
      originX,
      originY,
      occupancyMapPath: pgmRel,
      yamlPath: yamlRel,
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
      throw new HttpError(
        400,
        `invalid YAML: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const name =
      (typeof parsed.name === "string" && parsed.name) ||
      body.buildingName ||
      "imported";

    await writeBuildingYamlFiles(yamlText);

    const { rows } = await pool.query(
      `INSERT INTO buildings (name, meta)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (name) DO UPDATE SET meta = buildings.meta || EXCLUDED.meta
       RETURNING *`,
      [
        name,
        JSON.stringify({
          importedAt: new Date().toISOString(),
          source: "import-building",
        }),
      ],
    );
    const building = mapBuilding(rows[0] as Record<string, unknown>);

    const levelsObj = parsed.levels;
    if (levelsObj !== null && typeof levelsObj === "object") {
      let idx = 0;
      for (const levelName of Object.keys(
        levelsObj as Record<string, unknown>,
      )) {
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
    await publish("site.generated", {
      buildings: buildings.buildings,
      fleets: fleets.fleets,
      nav,
    });
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
      parsed = yaml.load(await fs.readFile(buildingPath, "utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      /* ignore parse for upsert */
    }

    // Ensure all lanes in building.yaml have graph_idx required by Open-RMF's generate_nav_graph
    if (parsed.levels !== null && typeof parsed.levels === "object") {
      let modified = false;
      for (const lvl of Object.values(parsed.levels as Record<string, unknown>)) {
        if (lvl !== null && typeof lvl === "object" && Array.isArray((lvl as Record<string, unknown>).lanes)) {
          const lanesArr = (lvl as Record<string, unknown>).lanes as unknown[];
          for (const item of lanesArr) {
            if (Array.isArray(item) && item.length >= 3 && typeof item[2] === "object" && item[2] !== null) {
              const params = item[2] as Record<string, unknown>;
              if (!params.graph_idx) {
                params.graph_idx = [2, 0];
                modified = true;
              }
            }
          }
        }
      }
      if (modified) {
        await writeBuildingYamlFiles(yaml.dump(parsed, { noRefs: true, lineWidth: 120 }));
      }
    }

    const name = typeof parsed.name === "string" ? parsed.name : "site";
    const { rows } = await pool.query(
      `INSERT INTO buildings (name, meta)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (name) DO UPDATE SET meta = buildings.meta || EXCLUDED.meta
       RETURNING *`,
      [
        name,
        JSON.stringify({
          appliedAt: new Date().toISOString(),
          source: "traffic-editor",
        }),
      ],
    );
    const building = mapBuilding(rows[0] as Record<string, unknown>);
    const levelsObj = parsed.levels;
    if (levelsObj !== null && typeof levelsObj === "object") {
      let idx = 0;
      for (const levelName of Object.keys(
        levelsObj as Record<string, unknown>,
      )) {
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
    if (!nav.ok) {
      throw new HttpError(
        500,
        `nav graph generation failed: ${nav.detail ?? "unknown"}`,
      );
    }
    const fleets = await generateSite();
    await touchReloadFlag();
    await publish("site.applied", {
      buildingId: building.id,
      nav,
      fleets: fleets.fleets,
    });
    res.json({ building, nav, fleets: fleets.fleets, reloadRequired: true });
  }),
);

/** Relaunch traffic-editor so it reloads the latest floorplan drawing. */
siteRouter.post(
  "/site/reload-traffic-editor",
  requireAuth,
  auditMutations,
  asyncHandler(async (_req, res) => {
    await touchTrafficEditorReload();
    res.json({ ok: true, reloading: true });
  }),
);

const parkingSpotSchema = z.object({
  levelName: z.string().min(1),
  name: z.string().min(1),
  x: z.number(),
  y: z.number(),
  yaw: z.number().optional().default(0),
  kind: z.enum(["parking", "charger", "stop"]).default("parking"),
});

const parkingBatchSchema = z.object({
  spots: z.array(parkingSpotSchema).min(1),
  apply: z.boolean().optional().default(true),
});

/** Simple wizard: add parking/charger/stop vertices to building YAML + optional apply. */
siteRouter.post(
  "/site/parking-spots",
  requireAuth,
  requireRole("supervisor"),
  auditMutations,
  asyncHandler(async (req, res) => {
    const body = parkingBatchSchema.parse(req.body);
    let buildingPath = await resolveBuildingYamlPath();
    if (buildingPath === null) {
      const levels: Record<string, unknown> = {};
      for (const s of body.spots) {
        if (!levels[s.levelName]) {
          levels[s.levelName] = { vertices: [], lanes: [], measurements: [] };
        }
      }
      await writeBuildingYamlFiles(yaml.dump({ name: "site", levels }));
      buildingPath =
        (await resolveBuildingYamlPath()) ??
        path.join(config.siteDir, "site.building.yaml");
    }

    const text = await fs.readFile(buildingPath, "utf8");
    const parsed = (yaml.load(text) as Record<string, unknown>) ?? {};
    if (!parsed.levels || typeof parsed.levels !== "object") parsed.levels = {};
    const levels = parsed.levels as Record<string, Record<string, unknown>>;

    for (const spot of body.spots) {
      const level: Record<string, unknown> = levels[spot.levelName] ?? {
        vertices: [],
        lanes: [],
        measurements: [],
      };
      levels[spot.levelName] = level;
      const verts = Array.isArray(level.vertices)
        ? [...(level.vertices as unknown[])]
        : [];
      const filtered = verts.filter((v) => {
        if (!Array.isArray(v) || v.length < 4) return true;
        return String(v[3]) !== spot.name;
      });
      const props: Record<string, unknown> =
        spot.kind === "charger"
          ? { is_parking_spot: [4, true], is_charger: [4, true] }
          : spot.kind === "stop"
            ? { is_holding_point: [4, true] }
            : { is_parking_spot: [4, true] };
      filtered.push([spot.x, spot.y, 0, spot.name, props]);
      level.vertices = filtered;
    }

    await writeBuildingYamlFiles(yaml.dump(parsed));

    if (!body.apply) {
      res.json({ ok: true, spots: body.spots.length, applied: false });
      return;
    }

    const nav = await tryGenerateNavGraphs();
    if (!nav.ok) {
      throw new HttpError(
        500,
        `nav graph generation failed: ${nav.detail ?? "unknown"}`,
      );
    }
    const fleets = await generateSite();
    await touchReloadFlag();
    await publish("site.applied", {
      source: "parking-wizard",
      nav,
      fleets: fleets.fleets,
    });
    res.json({
      ok: true,
      spots: body.spots.length,
      nav,
      fleets: fleets.fleets,
      reloadRequired: true,
    });
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
    if (graph === null || typeof graph !== "object")
      throw new HttpError(400, "graph body required");
    const { rows } = await pool.query(
      `UPDATE buildings SET graph = $2::jsonb WHERE id = $1 RETURNING *`,
      [buildingId, JSON.stringify(graph)],
    );
    if (rows[0] === undefined) throw notFound("building");
    const building = mapBuilding(rows[0] as Record<string, unknown>);
    await writeBuildingFromRegistry();
    const nav = await tryGenerateNavGraphs();
    await generateSite();
    await touchReloadFlag();
    await publish("registry.changed", {
      resource: "building",
      id: buildingId,
      action: "graph_updated",
    });
    res.json({ building, nav });
  }),
);

siteRouter.get(
  "/buildings/:id/graph",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM buildings WHERE id = $1", [
      req.params.id,
    ]);
    if (rows[0] === undefined) throw notFound("building");
    res.json(mapBuilding(rows[0] as Record<string, unknown>).graph);
  }),
);

const mappingCommandSchema = z.object({
  action: z.enum(["start", "stop", "save"]),
  levelId: z.string().uuid().optional(),
});

siteRouter.post(
  "/robots/:id/mapping",
  requireAuth,
  requireRole("supervisor"),
  auditMutations,
  asyncHandler(async (req, res) => {
    const robotId = req.params.id as string;
    const body = mappingCommandSchema.parse(req.body);
    const { rows } = await pool.query(
      "SELECT id, name, serial FROM robots WHERE id = $1",
      [robotId],
    );
    if (rows[0] === undefined) throw notFound("robot");
    const robotName = String(rows[0].name || rows[0].serial);
    const payload = {
      action: body.action,
      levelId: body.levelId ?? null,
      robotName,
      ts: new Date().toISOString(),
    };
    // One active SLAM session per fleet (or per level if levelId set).
    const lockKey =
      body.levelId !== undefined
        ? `mapping_lock:level:${body.levelId}`
        : "mapping_lock:fleet";
    if (body.action === "start") {
      const got = await cacheRedis.set(lockKey, robotId, "EX", 7200, "NX");
      if (got !== "OK") {
        const holder = await cacheRedis.get(lockKey);
        if (holder !== null && holder !== robotId) {
          throw new HttpError(409, `mapping already active on robot ${holder}`);
        }
      }
    } else if (body.action === "stop") {
      const holder = await cacheRedis.get(lockKey);
      if (holder === robotId) await cacheRedis.del(lockKey);
    }
    await publish("robot.mapping.command", { robotId, ...payload });
    await cacheRedis.set(`robot:${robotId}:ros_name`, robotName, "EX", 86400);
    await cacheRedis.set(
      `robot:${robotId}:mapping_cmd`,
      JSON.stringify(payload),
      "EX",
      3600,
    );
    if (body.action === "start") {
      await cacheRedis.set(
        `robot:${robotId}:mapping_state`,
        "starting",
        "EX",
        180,
      );
      await cacheRedis.del(
        `robot:${robotId}:mapping_error`,
        `robot:${robotId}:mapping_preview`,
        `robot:${robotId}:mapping_preview_ts`,
        `robot:${robotId}:mapping_preview_meta`,
        `robot:${robotId}:mapping_scan`,
        `robot:${robotId}:mapping_pose`,
      );
    } else if (body.action === "stop") {
      await cacheRedis.set(`robot:${robotId}:mapping_state`, "idle", "EX", 120);
      // Drop live session artifacts so the GUI does not keep the old map/lidar.
      await cacheRedis.del(
        `robot:${robotId}:mapping_preview`,
        `robot:${robotId}:mapping_preview_ts`,
        `robot:${robotId}:mapping_preview_meta`,
        `robot:${robotId}:mapping_scan`,
        `robot:${robotId}:mapping_error`,
        `robot:${robotId}:mapping_pose`,
      );
    } else if (body.action === "save") {
      await cacheRedis.set(
        `robot:${robotId}:mapping_state`,
        "saving",
        "EX",
        180,
      );
    }
    res.json({
      robotId,
      action: body.action,
      robotName,
      queued: true,
      transport: "ros",
    });
  }),
);

/** GUI reads mapping session state (starting / active / idle / saving / error). */
siteRouter.get(
  "/robots/:id/mapping/status",
  requireAuth,
  asyncHandler(async (req, res) => {
    const robotId = req.params.id as string;
    const state =
      (await cacheRedis.get(`robot:${robotId}:mapping_state`)) ?? "idle";
    const err = await cacheRedis.get(`robot:${robotId}:mapping_error`);
    const cmd = await cacheRedis.get(`robot:${robotId}:mapping_cmd`);
    const live = state !== "idle" && state !== "saved";
    const previewTs = live
      ? await cacheRedis.get(`robot:${robotId}:mapping_preview_ts`)
      : null;
    const metaRaw = live
      ? await cacheRedis.get(`robot:${robotId}:mapping_preview_meta`)
      : null;
    const scanRaw = live
      ? await cacheRedis.get(`robot:${robotId}:mapping_scan`)
      : null;
    const poseRaw = live
      ? await cacheRedis.get(`robot:${robotId}:mapping_pose`)
      : null;
    const meta = metaRaw !== null ? JSON.parse(metaRaw) : null;
    const scan = scanRaw !== null ? JSON.parse(scanRaw) : null;
    const pose =
      poseRaw !== null
        ? JSON.parse(poseRaw)
        : meta !== null &&
            typeof meta === "object" &&
            meta !== null &&
            "pose" in meta
          ? ((meta as { pose?: unknown }).pose ?? null)
          : null;
    res.json({
      state,
      error: err,
      pendingCommand: cmd !== null ? JSON.parse(cmd) : null,
      previewUpdatedAt: previewTs,
      preview: meta,
      scan,
      pose,
    });
  }),
);

/** Live SLAM occupancy preview (PNG) for the Mapping GUI. */
siteRouter.get(
  "/robots/:id/mapping/preview",
  requireAuth,
  asyncHandler(async (req, res) => {
    const robotId = req.params.id as string;
    const png = await cacheRedis.getBuffer(`robot:${robotId}:mapping_preview`);
    if (png === null) {
      res.status(404).json({ error: "no preview yet" });
      return;
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.send(png);
  }),
);

const teleopSchema = z.object({
  linear: z.number().min(-0.15).max(0.15),
  angular: z.number().min(-1.5).max(1.5),
});

/** On-screen joystick → Redis → mapping-bridge → ROS /fleet_teleop (not cmd_vel). */
siteRouter.post(
  "/robots/:id/teleop",
  requireAuth,
  requireRole("operator"),
  asyncHandler(async (req, res) => {
    const robotId = req.params.id as string;
    const body = teleopSchema.parse(req.body);
    const { rows } = await pool.query(
      "SELECT id, name, serial FROM robots WHERE id = $1",
      [robotId],
    );
    if (rows[0] === undefined) throw notFound("robot");
    const robotName = String(rows[0].name || rows[0].serial);
    const stopped =
      Math.abs(body.linear) < 1e-3 && Math.abs(body.angular) < 1e-3;
    await cacheRedis.set(`robot:${robotId}:ros_name`, robotName, "EX", 86400);
    await cacheRedis.set(
      `robot:${robotId}:teleop`,
      JSON.stringify({ ...body, stop: stopped, robotName, ts: Date.now() }),
      "EX",
      // Keep command alive between GUI polls; avoid Redis gaps that publish 0 → jerk.
      stopped ? 1 : 3,
    );
    res.json({ ok: true, transport: "ros" });
  }),
);

const joyTargetSchema = z.object({
  robotId: z.string().uuid(),
});

const JOY_SESSION_TTL_SEC = 8;

/** USB joy is armed only while the on-screen Drive pad keeps this session alive. */
siteRouter.get(
  "/joy-target",
  requireAuth,
  requireRole("operator"),
  asyncHandler(async (_req, res) => {
    const raw = await cacheRedis.get("fleet:joy_session");
    if (!raw) {
      res.json({ robotId: null, name: null, armed: false });
      return;
    }
    try {
      const parsed = JSON.parse(raw) as {
        id?: string;
        name?: string;
        armed?: boolean;
      };
      res.json({
        robotId: parsed.id ?? null,
        name: parsed.name ?? null,
        armed: parsed.armed === true,
      });
    } catch {
      res.json({ robotId: null, name: null, armed: false });
    }
  }),
);

siteRouter.put(
  "/joy-target",
  requireAuth,
  requireRole("operator"),
  asyncHandler(async (req, res) => {
    const body = joyTargetSchema.parse(req.body);
    const { rows } = await pool.query(
      "SELECT id, name, serial FROM robots WHERE id = $1",
      [body.robotId],
    );
    if (rows[0] === undefined) throw notFound("robot");
    const robotName = String(rows[0].name || rows[0].serial);
    await cacheRedis.set(`robot:${body.robotId}:ros_name`, robotName, "EX", 86400);
    await cacheRedis.set(
      "fleet:joy_session",
      JSON.stringify({
        id: body.robotId,
        name: robotName,
        armed: true,
        ts: Date.now(),
      }),
      "EX",
      JOY_SESSION_TTL_SEC,
    );
    res.json({ ok: true, robotId: body.robotId, name: robotName, armed: true });
  }),
);

siteRouter.delete(
  "/joy-target",
  requireAuth,
  requireRole("operator"),
  asyncHandler(async (_req, res) => {
    await cacheRedis.del("fleet:joy_session");
    await cacheRedis.del("fleet:joy_target");
    res.json({ ok: true, armed: false });
  }),
);
