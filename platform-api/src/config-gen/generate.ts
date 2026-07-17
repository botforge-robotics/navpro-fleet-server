import { promises as fs } from "fs";
import path from "path";
import yaml from "js-yaml";
import { config } from "../config";
import { pool } from "../db/pool";
import { logger, errorFields } from "../logger";
import { mapBuilding, mapDevice, mapFleet, mapLevel, mapRobot } from "../registry/mappers";
import type { Fleet, Level, Robot } from "../models";
import { fleetConfigSchema, type FleetConfig } from "./schema";

const DEFAULT_LIMITS = { linear: [0.5, 0.75] as [number, number], angular: [0.6, 2.0] as [number, number] };
const DEFAULT_PROFILE = { footprint: 0.3, vicinity: 0.5 };
const DEFAULT_BATTERY = { voltage: 24.0, capacity: 20.0, charging_current: 5.0 };

async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, contents, "utf8");
  await fs.rename(tmp, filePath);
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function buildFleetConfig(fleet: Fleet, robots: Robot[], levelsById: Map<string, Level>): FleetConfig {
  const levelNameFor = (key: string): string => levelsById.get(key)?.name ?? key;
  const overrides = fleet.config;

  // Battery system: fleet config override wins, else first robot's battery_spec, else defaults.
  const firstSpec = robots.find((r) => Object.keys(r.batterySpec).length > 0)?.batterySpec ?? {};
  const batterySystem = {
    voltage: num((overrides.battery_system as Record<string, unknown> | undefined)?.voltage, num(firstSpec.voltage, DEFAULT_BATTERY.voltage)),
    capacity: num((overrides.battery_system as Record<string, unknown> | undefined)?.capacity, num(firstSpec.capacityAh, DEFAULT_BATTERY.capacity)),
    charging_current: num(
      (overrides.battery_system as Record<string, unknown> | undefined)?.charging_current,
      num(firstSpec.chargingCurrentA, DEFAULT_BATTERY.charging_current),
    ),
  };

  // Per-level map transforms aggregated from robots.map_transform. Keys are
  // level ids (GUI convention); the coordinator config wants level names.
  const transforms: FleetConfig["rmf_fleet"]["transforms"] = {};
  for (const robot of robots) {
    for (const [levelKey, t] of Object.entries(robot.mapTransform)) {
      transforms[levelNameFor(levelKey)] = {
        translation: [num(t.x, 0), num(t.y, 0)],
        rotation: num(t.yaw, 0),
        scale: num(t.scale, 1),
      };
    }
  }

  const robotEntries: FleetConfig["rmf_fleet"]["robots"] = {};
  for (const robot of robots) {
    const level = robot.levelId !== null ? levelsById.get(robot.levelId) : undefined;
    const entry: FleetConfig["rmf_fleet"]["robots"][string] = {
      navigation_stack: 2,
      initial_map: level?.name ?? "L1",
    };
    if (robot.dockWaypoint !== null) entry.charger = robot.dockWaypoint;
    robotEntries[robot.name ?? robot.serial] = entry;
  }

  return {
    rmf_fleet: {
      name: fleet.name,
      limits: (overrides.limits as typeof DEFAULT_LIMITS | undefined) ?? DEFAULT_LIMITS,
      profile: (overrides.profile as typeof DEFAULT_PROFILE | undefined) ?? DEFAULT_PROFILE,
      battery_system: batterySystem,
      recharge_threshold: num(overrides.recharge_threshold, 0.2),
      recharge_soc: num(overrides.recharge_soc, 1.0),
      task_capabilities: (overrides.task_capabilities as { loop: boolean; delivery: boolean; clean: boolean } | undefined) ?? {
        loop: true,
        delivery: false,
        clean: false,
      },
      transforms,
      robots: robotEntries,
    },
    // Performable dock action — Nav2RobotAdapter loads plugins; robots host /dock_robot.
    plugins: (overrides.plugins as Record<string, unknown> | undefined) ?? {
      dock: { actions: ["dock", "undock"] },
    },
  };
}

/**
 * Generates all site artifacts from the registry (the source of truth):
 * fleet_config/<fleet>.yaml per fleet and site/registry-snapshot.json.
 * Everything is zod-validated and written atomically (tmp + rename).
 */
export async function generateSite(): Promise<{ fleets: string[] }> {
  const [fleetRows, robotRows, levelRows, buildingRows, deviceRows] = await Promise.all([
    pool.query("SELECT * FROM fleets ORDER BY name"),
    pool.query("SELECT * FROM robots WHERE status != 'retired' ORDER BY serial"),
    pool.query("SELECT * FROM levels ORDER BY name"),
    pool.query("SELECT * FROM buildings ORDER BY name"),
    pool.query("SELECT * FROM devices ORDER BY name"),
  ]);

  const fleets = fleetRows.rows.map(mapFleet);
  const robots = robotRows.rows.map(mapRobot);
  const levels = levelRows.rows.map(mapLevel);
  const buildings = buildingRows.rows.map(mapBuilding);
  const devices = deviceRows.rows.map(mapDevice);
  const levelsById = new Map(levels.map((l) => [l.id, l]));

  const written: string[] = [];
  for (const fleet of fleets) {
    const fleetRobots = robots.filter((r) => r.fleetId === fleet.id && r.status === "active");
    const fleetConfig = fleetConfigSchema.parse(buildFleetConfig(fleet, fleetRobots, levelsById));
    const filePath = path.join(config.siteDir, "fleet_config", `${fleet.name}.yaml`);
    await writeFileAtomic(filePath, yaml.dump(fleetConfig, { noRefs: true }));
    written.push(fleet.name);
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    fleets,
    robots,
    levels,
    buildings,
    devices,
  };
  await writeFileAtomic(
    path.join(config.siteDir, "registry-snapshot.json"),
    JSON.stringify(snapshot, null, 2),
  );

  logger.info("site artifacts generated", { fleets: written });

  // Also materialize building.yaml when any building has an in-browser graph.
  try {
    const { graphToBuildingYaml } = await import("../site/building-yaml");
    for (const building of buildings) {
      const hasGraph =
        building.graph.waypoints.length > 0 ||
        building.graph.lanes.length > 0 ||
        building.graph.doors.length > 0 ||
        building.graph.lifts.length > 0;
      if (!hasGraph) continue;
      const yamlText = graphToBuildingYaml(building.name, building.graph);
      await writeFileAtomic(path.join(config.siteDir, "building.yaml"), yamlText);
      break; // single active building.yaml for the site volume
    }
  } catch (err) {
    logger.warn("building.yaml materialize skipped", errorFields(err));
  }

  return { fleets: written };
}

/** Fire-and-forget regeneration used by event-driven triggers. */
export function generateSiteSafe(): void {
  generateSite().catch((err) => logger.error("site generation failed", errorFields(err)));
}
