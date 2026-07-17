import type { Building, BuildingGraph, Device, Fleet, Level, Robot } from "../models";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const EMPTY_GRAPH: BuildingGraph = { waypoints: [], lanes: [], doors: [], lifts: [] };

function mapGraph(raw: unknown): BuildingGraph {
  if (raw === null || typeof raw !== "object") return { ...EMPTY_GRAPH };
  const g = raw as Record<string, unknown>;
  return {
    waypoints: Array.isArray(g.waypoints) ? (g.waypoints as BuildingGraph["waypoints"]) : [],
    lanes: Array.isArray(g.lanes) ? (g.lanes as BuildingGraph["lanes"]) : [],
    doors: Array.isArray(g.doors) ? (g.doors as BuildingGraph["doors"]) : [],
    lifts: Array.isArray(g.lifts) ? (g.lifts as BuildingGraph["lifts"]) : [],
  };
}

export function mapRobot(row: Row): Robot {
  return {
    id: row.id,
    serial: row.serial,
    name: row.name,
    fleetId: row.fleet_id,
    mac: row.mac,
    wifiSsid: row.wifi_ssid,
    levelId: row.level_id,
    batterySpec: row.battery_spec ?? {},
    payload: row.payload ?? {},
    dockWaypoint: row.dock_waypoint,
    homeWaypoint: row.home_waypoint ?? null,
    firmwareVersion: row.firmware_version,
    piVersion: row.pi_version,
    configVersion: row.config_version,
    capabilities: row.capabilities ?? [],
    mapTransform: row.map_transform ?? {},
    status: row.status,
    lastSeen: row.last_seen instanceof Date ? row.last_seen.toISOString() : row.last_seen,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

export function mapFleet(row: Row): Fleet {
  return { id: row.id, name: row.name, config: row.config ?? {}, status: row.status };
}

export function mapLevel(row: Row): Level {
  return {
    id: row.id,
    name: row.name,
    buildingId: row.building_id,
    floorplanPath: row.floorplan_path,
    occupancyMapPath: row.occupancy_map_path,
    navGraphIndex: row.nav_graph_index,
    elevation: row.elevation,
    metersPerPixel: row.meters_per_pixel ?? 0.05,
    originX: row.origin_x ?? 0,
    originY: row.origin_y ?? 0,
  };
}

export function mapBuilding(row: Row): Building {
  return {
    id: row.id,
    name: row.name,
    meta: row.meta ?? {},
    graph: mapGraph(row.graph),
  };
}

export function mapDevice(row: Row): Device {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    plugin: row.plugin,
    levelId: row.level_id,
    config: row.config ?? {},
    enabled: row.enabled,
  };
}
