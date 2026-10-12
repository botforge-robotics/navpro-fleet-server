import { config } from "../config";
import { pool } from "../db/pool";
import { logger } from "../logger";

/**
 * Ensure a default building, floor (L1), and fleet exist so the first robot
 * can be commissioned before any mapping / Building work.
 */
export async function seedSiteDefaults(): Promise<void> {
  const fleetName = config.defaultFleetName;
  const levelName = config.defaultLevelName;
  const buildingName = config.defaultBuildingName;

  const building = await pool.query(
    `INSERT INTO buildings (name, meta)
     VALUES ($1, '{}'::jsonb)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [buildingName],
  );
  const buildingId = building.rows[0].id as string;

  await pool.query(
    `INSERT INTO levels (name, building_id, nav_graph_index, elevation)
     VALUES ($1, $2, 0, 0)
     ON CONFLICT (building_id, name) DO NOTHING`,
    [levelName, buildingId],
  );

  await pool.query(
    `INSERT INTO fleets (name, config, status)
     VALUES ($1, '{}'::jsonb, 'active')
     ON CONFLICT (name) DO NOTHING`,
    [fleetName],
  );

  logger.info("site defaults ready", { fleetName, levelName, buildingName });
}
