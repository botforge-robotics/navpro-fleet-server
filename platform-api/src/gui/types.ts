// GUI-facing view types, mirroring web-gui/src/api/types.ts.
// These are platform-native shapes (no RMF concepts).

export type GuiRobotMode = "idle" | "navigating" | "charging" | "docking" | "paused" | "error" | "offline";

export interface GuiLevelTransform {
  levelId: string;
  x: number;
  y: number;
  yaw: number;
  scale: number;
}

export interface GuiRobotHealth {
  estop: boolean;
  wifiRssi: number | null;
  cpuTempC: number | null;
  batteryTempC: number | null;
  motorFault: boolean;
  navMode: string | null;
  readyForTasks: boolean;
}

export interface GuiRobotPose {
  x: number;
  y: number;
  yaw: number;
}

export interface GuiRobot {
  id: string;
  name: string;
  serial: string;
  mac: string;
  fleetId: string | null;
  levelId: string | null;
  mode: GuiRobotMode;
  batteryPercent: number | null;
  pose: GuiRobotPose | null;
  health: GuiRobotHealth | null;
  transforms: GuiLevelTransform[];
  firmwareVersion: string | null;
  retired: boolean;
  lastSeen: string | null;
  /** Registry status: unprovisioned | active | maintenance | retired */
  status: string;
  dockWaypoint: string | null;
  homeWaypoint: string | null;
}

export interface GuiLevel {
  id: string;
  name: string;
  buildingId: string;
  imageUrl: string;
  metersPerPixel: number;
  originX: number;
  originY: number;
}

export interface GuiFleet {
  id: string;
  name: string;
  robotCount: number;
}

export type GuiAlarmSeverity = "info" | "warning" | "critical";

export interface GuiAlarm {
  id: string;
  severity: GuiAlarmSeverity;
  message: string;
  robotId: string | null;
  raisedAt: string;
  acknowledged: boolean;
}

export interface GuiServerInfo {
  version: string;
  rmfConnected: boolean;
  uptimeSeconds: number;
}

export type GuiMissionStepState =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "retrying"
  | "compensating"
  | "compensated"
  | "skipped";

export interface GuiMissionStep {
  id: string;
  missionId: string;
  index: number;
  type: string;
  name: string;
  state: GuiMissionStepState;
  attempts: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface GuiMission {
  id: string;
  workflowId: string;
  workflowVersion: number;
  fleetId: string;
  robotId: string | null;
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | "needs_operator";
  steps: GuiMissionStep[];
  createdAt: string;
  updatedAt: string;
}

export type GuiOnFailurePolicy =
  | { action: "retry"; maxAttempts: number; backoffSeconds: number }
  | { action: "compensate" }
  | { action: "halt_and_alert" };

export interface GuiWorkflowStep {
  id: string;
  type: string;
  name: string;
  params: Record<string, unknown>;
  onFailure: GuiOnFailurePolicy;
}

export interface GuiWorkflowVersion {
  id: string;
  workflowId: string;
  version: number;
  steps: GuiWorkflowStep[];
  author: string;
  createdAt: string;
}
