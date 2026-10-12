import { promises as fs } from "fs";
import path from "path";
import yaml from "js-yaml";
import { config } from "../config";
import { pool } from "../db/pool";
import { logger, errorFields } from "../logger";
import {
  mapBuilding,
  mapDevice,
  mapFleet,
  mapLevel,
  mapRobot,
} from "../registry/mappers";
import type { Fleet, Level, Robot } from "../models";
import { fleetConfigSchema, type FleetConfig } from "./schema";
import {
  occupancyMapHeightMeters,
  yFlipReferenceCoordinates,
} from "../site/map-sync";

const DEFAULT_LIMITS = {
  linear: [0.5, 0.75] as [number, number],
  angular: [0.6, 2.0] as [number, number],
};
const DEFAULT_PROFILE = { footprint: 0.3, vicinity: 0.5 };
const DEFAULT_BATTERY = {
  voltage: 24.0,
  capacity: 20.0,
  charging_current: 5.0,
};
const DEFAULT_MECHANICAL = {
  mass: 20.0,
  moment_of_inertia: 10.0,
  friction_coefficient: 0.22,
};
const DEFAULT_AMBIENT = { power: 20.0 };
const DEFAULT_TOOL = { power: 0.0 };

async function writeFileAtomic(
  filePath: string,
  contents: string,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, contents, "utf8");
  await fs.rename(tmp, filePath);
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function buildFleetConfig(
  fleet: Fleet,
  robots: Robot[],
  levelsById: Map<string, Level>,
  mapHeightsM: Map<string, number> = new Map(),
): FleetConfig {
  const levelNameFor = (key: string): string =>
    levelsById.get(key)?.name ?? key;
  const overrides = fleet.config;

  // Battery system: fleet config override wins, else first robot's battery_spec, else defaults.
  const firstSpec =
    robots.find((r) => Object.keys(r.batterySpec).length > 0)?.batterySpec ??
    {};
  const batterySystem = {
    voltage: num(
      (overrides.battery_system as Record<string, unknown> | undefined)
        ?.voltage,
      num(firstSpec.voltage, DEFAULT_BATTERY.voltage),
    ),
    capacity: num(
      (overrides.battery_system as Record<string, unknown> | undefined)
        ?.capacity,
      num(firstSpec.capacityAh, DEFAULT_BATTERY.capacity),
    ),
    charging_current: num(
      (overrides.battery_system as Record<string, unknown> | undefined)
        ?.charging_current,
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
    const level =
      robot.levelId !== null ? levelsById.get(robot.levelId) : undefined;
    const entry: FleetConfig["rmf_fleet"]["robots"][string] = {
      navigation_stack: 2,
      initial_map: level?.name ?? "L1",
      // NavPro Mini AMCL uses base_link (not free_fleet default base_footprint).
      robot_frame: "base_link",
      map_frame: "map",
      // false: avoid idle go_to_place that can block RMF if Nav2 zenoh hangs
      responsive_wait: false,
      init_timeout_sec: 60,
    };
    if (robot.dockWaypoint !== null) entry.charger = robot.dockWaypoint;
    robotEntries[robot.name ?? robot.serial] = entry;
  }

  // Always derive RMF↔Nav2 from each level PGM height (origin [0,0,0]).
  // Never keep hardcoded reference_coordinates from fleet.config.
  const identityTriplet: [
    [number, number],
    [number, number],
    [number, number],
  ] = [
    [0.0, 0.0],
    [10.0, 0.0],
    [0.0, 10.0],
  ];
  const referenceCoordinates: NonNullable<
    FleetConfig["reference_coordinates"]
  > = {};
  const levelNames = new Set<string>();
  for (const level of levelsById.values()) levelNames.add(level.name);
  for (const robot of robots) {
    const level =
      robot.levelId !== null ? levelsById.get(robot.levelId) : undefined;
    levelNames.add(level?.name ?? "L1");
  }
  for (const levelName of levelNames) {
    const h = mapHeightsM.get(levelName);
    referenceCoordinates[levelName] =
      typeof h === "number" && h > 0
        ? yFlipReferenceCoordinates(h)
        : { rmf: identityTriplet, robot: identityTriplet };
  }

  return {
    rmf_fleet: {
      name: fleet.name,
      limits:
        (overrides.limits as typeof DEFAULT_LIMITS | undefined) ??
        DEFAULT_LIMITS,
      profile:
        (overrides.profile as typeof DEFAULT_PROFILE | undefined) ??
        DEFAULT_PROFILE,
      reversible: true,
      battery_system: batterySystem,
      mechanical_system:
        (overrides.mechanical_system as
          | typeof DEFAULT_MECHANICAL
          | undefined) ?? DEFAULT_MECHANICAL,
      ambient_system:
        (overrides.ambient_system as typeof DEFAULT_AMBIENT | undefined) ??
        DEFAULT_AMBIENT,
      tool_system:
        (overrides.tool_system as typeof DEFAULT_TOOL | undefined) ??
        DEFAULT_TOOL,
      recharge_threshold: num(overrides.recharge_threshold, 0.2),
      recharge_soc: num(overrides.recharge_soc, 1.0),
      publish_fleet_state: 10.0,
      account_for_battery_drain: true,
      finishing_request: "nothing",
      task_capabilities: (overrides.task_capabilities as
        | {
            loop: boolean;
            delivery: boolean;
            clean: boolean;
            patrol?: boolean;
          }
        | undefined) ?? {
        loop: true,
        delivery: true,
        clean: false,
        patrol: true,
      },
      transforms,
      robots: robotEntries,
    },
    // Day-1: no dock ActionFactory module on-robot yet — omit plugins so
    // Nav2RobotAdapter does not warn/break action loading on every add.
    plugins: (overrides.plugins as Record<string, unknown> | undefined) ?? {},
    reference_coordinates: referenceCoordinates,
  };
}

/**
 * Generates all site artifacts from the registry (the source of truth):
 * fleet_config/<fleet>.yaml per fleet and site/registry-snapshot.json.
 * Everything is zod-validated and written atomically (tmp + rename).
 */
export async function generateSite(): Promise<{ fleets: string[] }> {
  const [fleetRows, robotRows, levelRows, buildingRows, deviceRows] =
    await Promise.all([
      pool.query("SELECT * FROM fleets ORDER BY name"),
      pool.query(
        "SELECT * FROM robots WHERE status != 'retired' ORDER BY serial",
      ),
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
  const mapHeightsM = new Map<string, number>();
  for (const level of levels) {
    const h = await occupancyMapHeightMeters(level.id);
    if (h !== null) mapHeightsM.set(level.name, h);
  }
  for (const fleet of fleets) {
    const fleetRobots = robots.filter(
      (r) => r.fleetId === fleet.id && r.status === "active",
    );
    const fleetConfig = fleetConfigSchema.parse(
      buildFleetConfig(fleet, fleetRobots, levelsById, mapHeightsM),
    );
    const filePath = path.join(
      config.siteDir,
      "fleet_config",
      `${fleet.name}.yaml`,
    );
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

  // Materialize site.building.yaml (+ legacy building.yaml) when any building
  // has an in-browser graph. RMF requires the *.building.yaml suffix.
  try {
    const { graphToBuildingYaml } = await import("../site/building-yaml");
    const { writeBuildingYamlFiles } = await import("../site/building-files");
    for (const building of buildings) {
      const hasGraph =
        building.graph.waypoints.length > 0 ||
        building.graph.lanes.length > 0 ||
        building.graph.doors.length > 0 ||
        building.graph.lifts.length > 0;
      if (!hasGraph) continue;
      const yamlText = graphToBuildingYaml(building.name, building.graph);
      await writeBuildingYamlFiles(yamlText);
      break;
    }
  } catch (err) {
    logger.warn("building.yaml materialize skipped", errorFields(err));
  }

  return { fleets: written };
}

/** Fire-and-forget regeneration used by event-driven triggers. */
export function generateSiteSafe(): void {
  generateSite().catch((err) =>
    logger.error("site generation failed", errorFields(err)),
  );
}
