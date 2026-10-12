-- NavPro Platform system-of-record schema.
-- The admin user is seeded at startup from ADMIN_USERNAME/ADMIN_PASSWORD (bcrypt), not here.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('operator', 'supervisor', 'admin', 'support')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE buildings (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE levels (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  building_id        uuid REFERENCES buildings(id) ON DELETE SET NULL,
  floorplan_path     text,
  occupancy_map_path text,
  nav_graph_index    integer NOT NULL DEFAULT 0,
  elevation          real NOT NULL DEFAULT 0,
  UNIQUE (building_id, name)
);

CREATE TABLE fleets (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name   text NOT NULL UNIQUE,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reloading'))
);

CREATE TABLE robots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial           text NOT NULL UNIQUE,
  name             text,
  fleet_id         uuid REFERENCES fleets(id) ON DELETE SET NULL,
  mac              text,
  wifi_ssid        text,
  level_id         uuid REFERENCES levels(id) ON DELETE SET NULL,
  battery_spec     jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  dock_waypoint    text,
  firmware_version text,
  pi_version       text,
  config_version   text,
  capabilities     jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- per-level alignment transforms: { "<levelName>": { "x": 0, "y": 0, "yaw": 0, "scale": 1 } }
  map_transform    jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'unprovisioned'
                   CHECK (status IN ('unprovisioned', 'active', 'maintenance', 'retired')),
  last_seen        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX robots_fleet_idx ON robots(fleet_id);

CREATE TABLE workflows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workflow_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version     integer NOT NULL,
  definition  jsonb NOT NULL,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, version)
);

CREATE TABLE missions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_version_id uuid NOT NULL REFERENCES workflow_versions(id),
  robot_id            uuid REFERENCES robots(id) ON DELETE SET NULL,
  fleet_id            uuid REFERENCES fleets(id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN
                      ('pending', 'compiling', 'running', 'needs_operator', 'completed', 'failed', 'cancelled')),
  saga_state          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX missions_status_idx ON missions(status);

CREATE TABLE mission_steps (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  seq        integer NOT NULL,
  type       text NOT NULL,
  params     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN
             ('pending', 'running', 'retrying', 'compensating', 'done', 'failed', 'skipped')),
  attempts   integer NOT NULL DEFAULT 0,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mission_id, seq)
);

CREATE TABLE robot_state_history (
  id          bigserial PRIMARY KEY,
  robot_id    uuid NOT NULL REFERENCES robots(id) ON DELETE CASCADE,
  ts          timestamptz NOT NULL DEFAULT now(),
  pose        jsonb,
  mode        text,
  battery_soc real,
  task_id     text
);
CREATE INDEX robot_state_history_robot_ts_idx ON robot_state_history(robot_id, ts DESC);

CREATE TABLE health_history (
  id          bigserial PRIMARY KEY,
  robot_id    uuid NOT NULL REFERENCES robots(id) ON DELETE CASCADE,
  ts          timestamptz NOT NULL DEFAULT now(),
  cpu         real,
  mem         real,
  temp        real,
  disk        real,
  wifi_rssi   real,
  battery_soc real,
  motor_fault boolean,
  estop       boolean,
  lidar_ok    boolean,
  camera_ok   boolean,
  extra       jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX health_history_robot_ts_idx ON health_history(robot_id, ts DESC);

CREATE TABLE devices (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name     text NOT NULL UNIQUE,
  type     text NOT NULL CHECK (type IN ('door', 'lift', 'dispenser', 'dock', 'plc', 'camera', 'custom')),
  plugin   text NOT NULL,
  level_id uuid REFERENCES levels(id) ON DELETE SET NULL,
  config   jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled  boolean NOT NULL DEFAULT true
);

CREATE TABLE ota_artifacts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel    text NOT NULL CHECK (channel IN ('pi', 'esp32', 'config')),
  version    text NOT NULL,
  path       text NOT NULL,
  sha256     text NOT NULL,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, version)
);

CREATE TABLE ota_rollouts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES ota_artifacts(id) ON DELETE CASCADE,
  robot_id    uuid NOT NULL REFERENCES robots(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'staged' CHECK (status IN
              ('staged', 'offered', 'installing', 'installed', 'failed', 'rolled_back')),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ota_rollouts_robot_idx ON ota_rollouts(robot_id, status);

CREATE TABLE audit_log (
  id       bigserial PRIMARY KEY,
  ts       timestamptz NOT NULL DEFAULT now(),
  username text NOT NULL,
  action   text NOT NULL,
  resource text NOT NULL,
  detail   jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Durable event archive (event bus mirror).
CREATE TABLE events (
  id      bigserial PRIMARY KEY,
  ts      timestamptz NOT NULL DEFAULT now(),
  type    text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX events_type_ts_idx ON events(type, ts DESC);
