import yaml from "js-yaml";
import type { BuildingGraph } from "../models";

/**
 * Materialize RMF building.yaml from the in-browser graph stored on a building.
 */
export function graphToBuildingYaml(buildingName: string, graph: BuildingGraph): string {
  const levelNames = new Set<string>();
  for (const w of graph.waypoints) levelNames.add(w.levelName);
  for (const d of graph.doors) levelNames.add(d.levelName);
  for (const lift of graph.lifts) for (const l of lift.levels) levelNames.add(l);
  if (levelNames.size === 0) levelNames.add("L1");

  const levels: Record<string, unknown> = {};
  for (const levelName of [...levelNames].sort()) {
    const wps = graph.waypoints.filter((w) => w.levelName === levelName);
    const idToIndex = new Map(wps.map((w, i) => [w.id, i]));
    const vertices = wps.map((w) => {
      const props: Record<string, unknown> = {};
      if (w.isCharger) props.is_charger = [4, true];
      if (w.isParking) props.is_parking_spot = [4, true];
      if (w.pickupDispenser) props.pickup_dispenser = [1, w.pickupDispenser];
      if (w.dropoffIngestor) props.dropoff_ingestor = [1, w.dropoffIngestor];
      return [w.x, w.y, 0.0, w.name, props];
    });
    const lanes = graph.lanes
      .filter((lane) => idToIndex.has(lane.fromId) && idToIndex.has(lane.toId))
      .map((lane) => [
        idToIndex.get(lane.fromId),
        idToIndex.get(lane.toId),
        { bidirectional: [4, lane.bidirectional !== false] },
      ]);
    const doors = graph.doors
      .filter((d) => d.levelName === levelName && idToIndex.has(d.fromId) && idToIndex.has(d.toId))
      .map((d) => [
        idToIndex.get(d.fromId),
        idToIndex.get(d.toId),
        {
          name: [1, d.name],
          type: [1, d.type ?? "sliding"],
          motion_axis_orientation: [2, 1],
        },
      ]);
    levels[levelName] = {
      elevation: levelName === "L1" ? 0 : 3.0,
      vertices,
      lanes,
      ...(doors.length > 0 ? { doors } : {}),
    };
  }

  const lifts: Record<string, unknown> = {};
  for (const lift of graph.lifts) {
    lifts[lift.name] = {
      reference_floor_name: lift.levels[0] ?? "L1",
      levels: lift.levels,
      doors: [],
      x: lift.x,
      y: lift.y,
      yaw: 0.0,
      width: lift.width ?? 1.5,
      depth: lift.depth ?? 1.5,
    };
  }

  const doc: Record<string, unknown> = { name: buildingName, levels };
  if (Object.keys(lifts).length > 0) doc.lifts = lifts;
  return yaml.dump(doc, { noRefs: true, lineWidth: 120 });
}
