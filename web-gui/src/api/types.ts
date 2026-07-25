// Platform API model mirrors (platform-native routes under /api/v1/*).
// Assumption: ids are strings (uuid), timestamps are ISO-8601 strings.

export interface User {
  id: string;
  username: string;
  role: 'operator' | 'supervisor' | 'admin' | 'support';
}

export interface LoginResponse {
  token: string;
  user: User;
}

export type RobotMode =
  | 'idle'
  | 'navigating'
  | 'charging'
  | 'docking'
  | 'paused'
  | 'error'
  | 'offline';

/** Per-level transform mapping a robot's SLAM map into building coordinates. */
export interface LevelTransform {
  levelId: string;
  x: number;
  y: number;
  yaw: number;
  scale: number;
}

export interface RobotHealth {
  estop: boolean;
  wifiRssi: number | null;
  cpuTempC: number | null;
  batteryTempC: number | null;
  motorFault: boolean;
  /** On-robot mode_manager: HARDWARE | MAPPING | NAV_READY | NAV_ACTIVE */
  navMode?: string | null;
  readyForTasks?: boolean;
}

export interface RobotPose {
  x: number;
  y: number;
  yaw: number;
}

export interface Robot {
  id: string;
  name: string;
  serial: string;
  mac: string;
  fleetId: string | null;
  levelId: string | null;
  mode: RobotMode;
  batteryPercent: number | null;
  pose: RobotPose | null;
  health: RobotHealth | null;
  transforms: LevelTransform[];
  firmwareVersion: string | null;
  retired: boolean;
  lastSeen: string | null;
  /** Registry status: unprovisioned | active | maintenance | retired */
  status?: string;
  dockWaypoint?: string | null;
  homeWaypoint?: string | null;
}

export interface Fleet {
  id: string;
  name: string;
  robotCount: number;
}

export interface Level {
  id: string;
  name: string;
  buildingId: string;
  /** Floorplan/occupancy image path, served through the Platform API (/api). */
  imageUrl: string;
  /** Meters per pixel of the floorplan image. */
  metersPerPixel: number;
  /** Building-frame coordinates of the image origin (bottom-left). */
  originX: number;
  originY: number;
}

export type WorkflowStepType =
  | 'goto'
  | 'wait'
  | 'capture_image'
  | 'publish'
  | 'call_service'
  | 'dock'
  | 'charge'
  | 'custom';

export type OnFailurePolicy =
  | { action: 'retry'; maxAttempts: number; backoffSeconds: number }
  | { action: 'compensate' }
  | { action: 'halt_and_alert' };

export interface WorkflowStep {
  id: string;
  type: WorkflowStepType;
  name: string;
  params: Record<string, unknown>;
  onFailure: OnFailurePolicy;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  latestVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  version: number;
  steps: WorkflowStep[];
  author: string;
  createdAt: string;
}

export type MissionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'needs_operator';

/** Saga state of one compiled workflow step inside a mission. */
export type MissionStepState =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'retrying'
  | 'compensating'
  | 'compensated'
  | 'skipped';

export interface MissionStep {
  id: string;
  missionId: string;
  index: number;
  type: WorkflowStepType;
  name: string;
  state: MissionStepState;
  attempts: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface Mission {
  id: string;
  workflowId: string;
  workflowVersion: number;
  fleetId: string;
  robotId: string | null;
  status: MissionStatus;
  steps: MissionStep[];
  createdAt: string;
  updatedAt: string;
}

export type DeviceType =
  | 'door'
  | 'lift'
  | 'dispenser'
  | 'charger'
  | 'plc'
  | 'camera'
  | 'custom_action';

export interface DeviceCommand {
  name: string;
  label: string;
  params: Record<string, unknown>;
}

/** Generic Device plugin surface: Status / Command / Health / Capabilities. */
export interface DeviceCapabilities {
  commands: DeviceCommand[];
  hasHealth: boolean;
}

export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  levelId: string | null;
  status: Record<string, unknown>;
  health: Record<string, unknown> | null;
  capabilities: DeviceCapabilities;
  config?: Record<string, unknown>;
  plugin?: string;
}

export interface HealthSample {
  robotId: string;
  timestamp: string;
  batteryPercent: number | null;
  wifiRssi: number | null;
  cpuTempC: number | null;
  batteryTempC: number | null;
  cpuLoad: number | null;
  estop: boolean;
}

export interface Alarm {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  robotId: string | null;
  raisedAt: string;
  acknowledged: boolean;
}

export interface ServerInfo {
  version: string;
  rmfConnected: boolean;
  uptimeSeconds: number;
}
