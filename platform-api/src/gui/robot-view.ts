import { pool } from "../db/pool";
import { cacheRedis } from "../redis";
import { ONLINE_SET_KEY } from "../health/routes";
import type { GuiLevelTransform, GuiRobot, GuiRobotHealth, GuiRobotMode, GuiRobotPose } from "./types";

const MODES: readonly GuiRobotMode[] = ["idle", "navigating", "charging", "docking", "paused", "error", "offline"];

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export interface GuiRobotEntry {
  robot: GuiRobot;
  fleetName: string | null;
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Heartbeats may report SOC as 0-1 (sensor convention) or 0-100. */
export function toBatteryPercent(value: unknown): number | null {
  const n = asNumber(value);
  if (n === null) return null;
  return n <= 1 ? Math.round(n * 1000) / 10 : n;
}

function toTransforms(mapTransform: unknown): GuiLevelTransform[] {
  if (mapTransform === null || typeof mapTransform !== "object") return [];
  const out: GuiLevelTransform[] = [];
  for (const [levelId, raw] of Object.entries(mapTransform as Record<string, unknown>)) {
    if (raw === null || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    out.push({
      levelId,
      x: asNumber(t.x) ?? 0,
      y: asNumber(t.y) ?? 0,
      yaw: asNumber(t.yaw) ?? 0,
      scale: asNumber(t.scale) ?? 1,
    });
  }
  return out;
}

function toPose(raw: unknown): GuiRobotPose | null {
  if (raw === null || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const x = asNumber(p.x);
  const y = asNumber(p.y);
  if (x === null || y === null) return null;
  return { x, y, yaw: asNumber(p.yaw) ?? 0 };
}

function toHealth(raw: Record<string, unknown> | null): GuiRobotHealth | null {
  if (raw === null) return null;
  const extra = raw.extra !== null && typeof raw.extra === "object" ? (raw.extra as Record<string, unknown>) : {};
  return {
    estop: raw.estop === true,
    wifiRssi: asNumber(raw.wifiRssi),
    cpuTempC: asNumber(raw.temp),
    batteryTempC: asNumber(extra.batteryTempC),
    motorFault: raw.motorFault === true,
  };
}

function toMode(stateMode: unknown, online: boolean): GuiRobotMode {
  if (!online) return "offline";
  if (typeof stateMode === "string" && (MODES as readonly string[]).includes(stateMode) && stateMode !== "offline") {
    return stateMode as GuiRobotMode;
  }
  return "idle";
}

/**
 * Registry rows enriched with live state/health from redis-cache into the
 * GUI's Robot shape. Pass robotId to fetch a single robot.
 */
export async function fetchGuiRobots(robotId?: string): Promise<GuiRobotEntry[]> {
  const { rows } = robotId !== undefined
    ? await pool.query(
        `SELECT r.*, f.name AS fleet_name FROM robots r LEFT JOIN fleets f ON f.id = r.fleet_id WHERE r.id = $1`,
        [robotId],
      )
    : await pool.query(
        `SELECT r.*, f.name AS fleet_name FROM robots r LEFT JOIN fleets f ON f.id = r.fleet_id ORDER BY r.serial`,
      );

  const online = new Set(await cacheRedis.smembers(ONLINE_SET_KEY));

  return Promise.all(
    (rows as Row[]).map(async (row) => {
      const [stateRaw, healthRaw] = await Promise.all([
        cacheRedis.get(`robot:${row.id}:state`),
        cacheRedis.get(`robot:${row.id}:health`),
      ]);
      const state = stateRaw !== null ? (JSON.parse(stateRaw) as Record<string, unknown>) : null;
      const health = healthRaw !== null ? (JSON.parse(healthRaw) as Record<string, unknown>) : null;
      const isOnline = online.has(String(row.id));

      const robot: GuiRobot = {
        id: row.id,
        name: row.name ?? row.serial,
        serial: row.serial,
        mac: row.mac ?? "",
        fleetId: row.fleet_id,
        levelId: row.level_id,
        mode: toMode(state?.mode, isOnline),
        batteryPercent: toBatteryPercent(health?.batterySoc ?? state?.batterySoc),
        pose: toPose(state?.pose ?? null),
        health: toHealth(health),
        transforms: toTransforms(row.map_transform),
        firmwareVersion: row.firmware_version,
        retired: row.status === "retired",
        lastSeen: iso(row.last_seen),
        status: typeof row.status === "string" ? row.status : "unprovisioned",
        dockWaypoint: row.dock_waypoint ?? null,
        homeWaypoint: row.home_waypoint ?? null,
      };
      return { robot, fleetName: row.fleet_name ?? null };
    }),
  );
}
