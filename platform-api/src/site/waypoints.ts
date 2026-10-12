import { promises as fs } from "fs";
import path from "path";
import yaml from "js-yaml";
import { config } from "../config";
import { pool } from "../db/pool";

export interface WaypointInfo {
  name: string;
  x: number;
  y: number;
  yaw: number;
  isParking: boolean;
  isCharger: boolean;
  levelId: string;
  levelName: string;
}

function parseVerts(raw: unknown, levelId: string, levelName: string): WaypointInfo[] {
  if (!Array.isArray(raw)) return [];
  const out: WaypointInfo[] = [];
  for (const v of raw) {
    // Format A (building.yaml): [x, y, z, name, {props}]
    // Format B (nav_graphs): [x, y, {is_parking_spot, name, ...}]
    if (!Array.isArray(v) || v.length < 2) continue;
    const x = Number(v[0]);
    const y = Number(v[1]);
    if (Number.isNaN(x) || Number.isNaN(y)) continue;

    let name = "";
    let props: Record<string, unknown> = {};
    if (v.length >= 4 && typeof v[3] === "string") {
      name = v[3];
      if (v.length >= 5 && v[4] !== null && typeof v[4] === "object") {
        props = v[4] as Record<string, unknown>;
      }
    } else if (v.length >= 3 && v[2] !== null && typeof v[2] === "object") {
      props = v[2] as Record<string, unknown>;
      name = typeof props.name === "string" ? props.name : "";
    }
    if (!name) continue;

    const parking = props.is_parking_spot;
    const charger = props.is_charger;
    const isParking = Array.isArray(parking) ? Boolean(parking[1]) : Boolean(parking);
    const isCharger = Array.isArray(charger) ? Boolean(charger[1]) : Boolean(charger);
    let yaw = 0;
    const yawProp = props.yaw ?? props.orientation;
    if (typeof yawProp === "number") yaw = yawProp;
    else if (Array.isArray(yawProp) && typeof yawProp[1] === "number") yaw = yawProp[1];
    out.push({ name, x, y, yaw, isParking, isCharger, levelId, levelName });
  }
  return out;
}

/** Load waypoints for a level from nav_graphs/<index>.yaml or building yaml verts. */
export async function listLevelWaypoints(
  levelId: string,
  parkingOnly = false,
): Promise<WaypointInfo[]> {
  const { rows } = await pool.query(
    "SELECT id, name, nav_graph_index FROM levels WHERE id = $1",
    [levelId],
  );
  if (rows[0] === undefined) return [];
  const levelName = String(rows[0].name);
  const idx = typeof rows[0].nav_graph_index === "number" ? rows[0].nav_graph_index : 0;

  const navPath = path.join(config.siteDir, "nav_graphs", `${idx}.yaml`);
  try {
    const text = await fs.readFile(navPath, "utf8");
    const parsed = yaml.load(text) as Record<string, unknown>;
    const levels = parsed.levels;
    let verts: unknown;
    if (Array.isArray(levels) && levels[0] && typeof levels[0] === "object") {
      verts = (levels[0] as Record<string, unknown>).vertices;
    } else if (levels !== null && typeof levels === "object") {
      const byName = (levels as Record<string, unknown>)[levelName] as Record<string, unknown> | undefined;
      verts = byName?.vertices ?? (Object.values(levels as Record<string, unknown>)[0] as Record<string, unknown>)?.vertices;
    }
    let list = parseVerts(verts, levelId, levelName);
    if (parkingOnly) list = list.filter((w) => w.isParking || w.isCharger);
    return list;
  } catch {
    /* fall through to building yaml */
  }

  // Fallback: site.building.yaml level vertices (pixel coords — still useful as names).
  for (const name of ["site.building.yaml", "building.yaml"]) {
    try {
      const text = await fs.readFile(path.join(config.siteDir, name), "utf8");
      const parsed = yaml.load(text) as Record<string, unknown>;
      const levels = parsed.levels as Record<string, unknown> | undefined;
      const level = levels?.[levelName] as Record<string, unknown> | undefined;
      if (!level) continue;
      let list = parseVerts(level.vertices, levelId, levelName);
      if (parkingOnly) list = list.filter((w) => w.isParking || w.isCharger);
      return list;
    } catch {
      continue;
    }
  }
  return [];
}

export async function resolveWaypointPose(
  levelId: string,
  waypointName: string,
): Promise<{ x: number; y: number; yaw: number } | null> {
  const list = await listLevelWaypoints(levelId, false);
  const hit = list.find((w) => w.name === waypointName);
  if (!hit) return null;
  return { x: hit.x, y: hit.y, yaw: hit.yaw };
}

/**
 * Traffic-editor / nav_graphs use RMF meters (Y flipped vs ROS map origin [0,0,0]).
 * Nav2 AMCL needs robot-map meters: robot_y = rmf_y + map_height_m
 * (height from that level's PGM×resolution — works for any map).
 */
export async function rmfPoseToRobotMapPose(
  levelId: string,
  pose: { x: number; y: number; yaw: number },
): Promise<{ x: number; y: number; yaw: number }> {
  const { occupancyMapHeightMeters } = await import("./map-sync");
  const mapHeightM = await occupancyMapHeightMeters(levelId);
  if (mapHeightM === null || !(mapHeightM > 0)) return { ...pose };
  return { x: pose.x, y: pose.y + mapHeightM, yaw: pose.yaw };
}
