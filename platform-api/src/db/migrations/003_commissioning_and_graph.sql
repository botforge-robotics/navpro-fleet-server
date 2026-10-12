-- Commissioning: home/parking waypoint per robot.
ALTER TABLE robots ADD COLUMN IF NOT EXISTS home_waypoint text;

-- Building navigation graph (Phase 3 in-browser editor). Stored as JSON;
-- config-gen materializes site/building.yaml + nav graphs from it.
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS graph jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Occupancy map metadata already on levels; ensure maps dir convention documented in site routes.
