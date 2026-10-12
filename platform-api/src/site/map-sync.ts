/**
 * Push occupancy claims to robots when the fleet GUI map / floor changes.
 * Robots also poll mapRevision via heartbeat and re-claim on mismatch.
 */
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";
import { config } from "../config";
import { pool } from "../db/pool";
import { cacheRedis } from "../redis";
import { publish } from "../events/bus";
import { logger } from "../logger";
import { parsePgm } from "./pgm-to-png";

export const DEFAULT_CLAIM_MAP_NAME = "active";

/** Fleet / Nav2 occupancy origin is always image bottom-left = (0,0,0). */
export const FLEET_MAP_ORIGIN: [number, number, number] = [0, 0, 0];

export async function hashOccupancyFiles(
  pgmAbs: string,
  yamlAbs: string,
): Promise<string> {
  const [pgm, yamlText] = await Promise.all([
    fs.readFile(pgmAbs),
    fs.readFile(yamlAbs, "utf8"),
  ]);
  return crypto
    .createHash("sha256")
    .update(pgm)
    .update("\n")
    .update(yamlText)
    .digest("hex")
    .slice(0, 16);
}

/** Resolve occupancy paths + revision for a level (null if missing). */
export async function levelOccupancyMeta(levelId: string): Promise<{
  levelId: string;
  levelName: string;
  mapName: string;
  mapRevision: string;
  pgmRel: string;
  yamlRel: string;
} | null> {
  const { rows } = await pool.query("SELECT * FROM levels WHERE id = $1", [
    levelId,
  ]);
  if (rows[0] === undefined) return null;
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
    return null;
  }
  const mapRevision = await hashOccupancyFiles(pgmAbs, yamlAbs);
  return {
    levelId,
    levelName,
    mapName: DEFAULT_CLAIM_MAP_NAME,
    mapRevision,
    pgmRel,
    yamlRel,
  };
}

/**
 * Map height in meters from PGM × map.yaml resolution (any size / any level).
 * Used for traffic-editor Y-flip ↔ Nav2 origin [0,0,0] — never hardcode.
 */
export async function occupancyMapHeightMeters(
  levelIdOrName: string,
): Promise<number | null> {
  let pgmRel = path.join("maps", levelIdOrName, "map.pgm");

  const byId = await pool.query("SELECT * FROM levels WHERE id = $1", [
    levelIdOrName,
  ]);
  if (byId.rows[0] !== undefined) {
    const row = byId.rows[0] as Record<string, unknown>;
    const levelName = String(row.name);
    pgmRel =
      typeof row.occupancy_map_path === "string" &&
      row.occupancy_map_path.length > 0
        ? row.occupancy_map_path
        : path.join("maps", levelName, "map.pgm");
  } else {
    const byName = await pool.query("SELECT * FROM levels WHERE name = $1", [
      levelIdOrName,
    ]);
    if (byName.rows[0] !== undefined) {
      const row = byName.rows[0] as Record<string, unknown>;
      const levelName = String(row.name);
      pgmRel =
        typeof row.occupancy_map_path === "string" &&
        row.occupancy_map_path.length > 0
          ? row.occupancy_map_path
          : path.join("maps", levelName, "map.pgm");
    }
  }

  const yamlRel = pgmRel.replace(/\.pgm$/i, ".yaml");
  const pgmAbs = path.join(config.siteDir, pgmRel);
  const yamlAbs = path.join(config.siteDir, yamlRel);
  try {
    const [pgmBuf, yamlText] = await Promise.all([
      fs.readFile(pgmAbs),
      fs.readFile(yamlAbs, "utf8"),
    ]);
    const { height } = parsePgm(pgmBuf);
    let res = 0.05;
    const parsed = yaml.load(yamlText) as Record<string, unknown> | null;
    if (
      parsed &&
      typeof parsed.resolution === "number" &&
      parsed.resolution > 0
    ) {
      res = parsed.resolution;
    }
    return height * res;
  } catch {
    return null;
  }
}

/**
 * RMF EasyFullControl reference_coordinates for traffic-editor Y-flip vs
 * Nav2 origin [0,0,0]. Height comes from the level's PGM — never hardcode.
 */
export function yFlipReferenceCoordinates(mapHeightM: number): {
  rmf: [[number, number], [number, number], [number, number]];
  robot: [[number, number], [number, number], [number, number]];
} {
  const h = mapHeightM;
  return {
    rmf: [
      [0.0, 0.0],
      [10.0, 0.0],
      [0.0, 10.0],
    ],
    robot: [
      [0.0, h],
      [10.0, h],
      [0.0, h + 10.0],
    ],
  };
}

export async function pushClaimMapToRobot(
  robotId: string,
  levelId: string,
  reason = "map_sync",
): Promise<void> {
  const meta = await levelOccupancyMeta(levelId);
  if (meta === null) {
    logger.info("claim_map skip: no occupancy", { robotId, levelId, reason });
    return;
  }
  const payload = {
    action: "claim_map",
    levelId,
    mapName: meta.mapName,
    mapRevision: meta.mapRevision,
    reason,
    ts: new Date().toISOString(),
  };
  await cacheRedis.set(
    `robot:${robotId}:fleet_cmd`,
    JSON.stringify(payload),
    "EX",
    3600,
  );
  await publish("robot.fleet.command", { robotId, ...payload });
  logger.info("claim_map queued", {
    robotId,
    levelId,
    reason,
    rev: meta.mapRevision,
  });
}

/** Queue claim_map for every non-retired robot assigned to this floor. */
export async function pushClaimMapToLevelRobots(
  levelId: string,
  reason = "occupancy_changed",
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM robots
     WHERE level_id = $1 AND status != 'retired'`,
    [levelId],
  );
  for (const row of rows) {
    try {
      await pushClaimMapToRobot(row.id, levelId, reason);
    } catch (err) {
      logger.warn("claim_map push failed", {
        robotId: row.id,
        levelId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return rows.length;
}
