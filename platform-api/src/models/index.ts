// Platform-native domain types. This module must never reference RMF concepts;
// the contract-boundary test enforces it mechanically.

export type Role = "operator" | "supervisor" | "admin" | "support";

export interface User {
  id: string;
  username: string;
  role: Role;
  createdAt: string;
}

export type RobotStatus = "unprovisioned" | "active" | "maintenance" | "retired";

export interface MapTransform {
  x: number;
  y: number;
  yaw: number;
  scale: number;
}

export interface BatterySpec {
  voltage?: number;
  capacityAh?: number;
  chargingCurrentA?: number;
  rechargeThreshold?: number;
  rechargeSocThreshold?: number;
}

export interface Robot {
  id: string;
  serial: string;
  name: string | null;
  fleetId: string | null;
  mac: string | null;
  wifiSsid: string | null;
  levelId: string | null;
  batterySpec: BatterySpec;
  payload: Record<string, unknown>;
  dockWaypoint: string | null;
  homeWaypoint: string | null;
  firmwareVersion: string | null;
  piVersion: string | null;
  configVersion: string | null;
  capabilities: string[];
  mapTransform: Record<string, MapTransform>;
  status: RobotStatus;
  lastSeen: string | null;
  createdAt: string;
}

export type FleetStatus = "active" | "reloading";

export interface Fleet {
  id: string;
  name: string;
  config: Record<string, unknown>;
  status: FleetStatus;
}

export interface Level {
  id: string;
  name: string;
  buildingId: string | null;
  floorplanPath: string | null;
  occupancyMapPath: string | null;
  navGraphIndex: number;
  elevation: number;
  metersPerPixel: number;
  originX: number;
  originY: number;
}

/** In-browser building graph (Phase 3). Materialized to building.yaml by config-gen. */
export interface BuildingGraphWaypoint {
  id: string;
  name: string;
  x: number;
  y: number;
  levelName: string;
  isCharger?: boolean;
  isParking?: boolean;
  pickupDispenser?: string;
  dropoffIngestor?: string;
}

export interface BuildingGraphLane {
  id: string;
  fromId: string;
  toId: string;
  bidirectional?: boolean;
}

export interface BuildingGraphDoor {
  id: string;
  name: string;
  levelName: string;
  fromId: string;
  toId: string;
  type?: string;
}

export interface BuildingGraphLift {
  id: string;
  name: string;
  x: number;
  y: number;
  levels: string[];
  width?: number;
  depth?: number;
}

export interface BuildingGraph {
  waypoints: BuildingGraphWaypoint[];
  lanes: BuildingGraphLane[];
  doors: BuildingGraphDoor[];
  lifts: BuildingGraphLift[];
}

export interface Building {
  id: string;
  name: string;
  meta: Record<string, unknown>;
  graph: BuildingGraph;
}

export type StepType = "goto" | "wait" | "capture_image" | "publish" | "call_service" | "dock" | "charge" | "custom";

export type OnFailurePolicy = "retry" | "compensate" | "halt_and_alert";

export interface StepOnFailure {
  policy: OnFailurePolicy;
  maxAttempts?: number;
  compensation?: WorkflowStep[];
}

export interface WorkflowStep {
  type: StepType;
  params: Record<string, unknown>;
  onFailure?: StepOnFailure;
}

export interface WorkflowDefinition {
  steps: WorkflowStep[];
}

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  version: number;
  definition: WorkflowDefinition;
  createdBy: string | null;
  createdAt: string;
}

export type MissionStatus =
  | "pending"
  | "compiling"
  | "running"
  | "needs_operator"
  | "completed"
  | "failed"
  | "cancelled";

export type MissionStepStatus = "pending" | "running" | "retrying" | "compensating" | "done" | "failed" | "skipped";

export interface Mission {
  id: string;
  workflowVersionId: string;
  robotId: string | null;
  fleetId: string | null;
  status: MissionStatus;
  sagaState: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MissionStep {
  id: string;
  missionId: string;
  seq: number;
  type: StepType;
  params: Record<string, unknown>;
  status: MissionStepStatus;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
}

export type DeviceType = "door" | "lift" | "dispenser" | "dock" | "plc" | "camera" | "custom";

export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  plugin: string;
  levelId: string | null;
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface HealthSample {
  robotId: string;
  ts: string;
  cpu?: number;
  mem?: number;
  temp?: number;
  disk?: number;
  wifiRssi?: number;
  batterySoc?: number;
  motorFault?: boolean;
  estop?: boolean;
  lidarOk?: boolean;
  cameraOk?: boolean;
  extra?: Record<string, unknown>;
}

export interface RobotState {
  robotId: string;
  ts: string;
  pose?: { x: number; y: number; yaw: number; levelName?: string };
  mode?: string;
  batterySoc?: number;
  taskId?: string;
}

export type OtaChannel = "pi" | "esp32" | "config";

export type OtaRolloutStatus = "staged" | "offered" | "installing" | "installed" | "failed" | "rolled_back";

export interface OtaArtifact {
  id: string;
  channel: OtaChannel;
  version: string;
  path: string;
  sha256: string;
  notes: string | null;
  createdAt: string;
}

export interface OtaRollout {
  id: string;
  artifactId: string;
  robotId: string;
  status: OtaRolloutStatus;
  updatedAt: string;
}
