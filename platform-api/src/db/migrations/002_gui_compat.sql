-- GUI contract compatibility: floorplan calibration on levels, artifact size,
-- and rollout grouping (ota_rollouts stays per-robot; rollout_group aggregates
-- the rows created by one POST /api/v1/ota/rollouts into the GUI's rollout).

ALTER TABLE levels ADD COLUMN meters_per_pixel real NOT NULL DEFAULT 0.05;
ALTER TABLE levels ADD COLUMN origin_x real NOT NULL DEFAULT 0;
ALTER TABLE levels ADD COLUMN origin_y real NOT NULL DEFAULT 0;

ALTER TABLE ota_artifacts ADD COLUMN size_bytes bigint NOT NULL DEFAULT 0;

ALTER TABLE ota_rollouts ADD COLUMN rollout_group uuid;
ALTER TABLE ota_rollouts ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
UPDATE ota_rollouts SET rollout_group = id WHERE rollout_group IS NULL;
ALTER TABLE ota_rollouts ALTER COLUMN rollout_group SET NOT NULL;
CREATE INDEX ota_rollouts_group_idx ON ota_rollouts(rollout_group);
