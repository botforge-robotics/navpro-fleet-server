import { pool } from "../db/pool";
import { logger, errorFields } from "../logger";
import { cacheRedis } from "../redis";
import { publish } from "../events/bus";
import type { MissionStatus } from "../models";
import { getTaskStatus, submitChargeTask, submitGotoTask } from "./rmf-tasks";

/**
 * Saga engine. Each mission is a sequence of mission_steps rows; every status
 * transition is persisted so a process restart resumes in-flight missions
 * deterministically (resumeInFlightMissions). Navigation-shaped steps are
 * delegated to the external fleet coordinator via rmf-tasks.ts and polled;
 * everything else is platform-orchestrated.
 */

const DEFAULT_MAX_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 2_000;
const MAX_BACKOFF_MS = 30_000;

interface RunnerControl {
  cancelRequested: boolean;
}

const runners = new Map<string, RunnerControl>();

type MissionRow = {
  id: string;
  workflow_version_id: string;
  robot_id: string | null;
  fleet_id: string | null;
  status: MissionStatus;
  saga_state: Record<string, unknown>;
};

type StepRow = {
  id: string;
  seq: number;
  type: string;
  params: Record<string, unknown>;
  status: string;
  attempts: number;
};

/**
 * Workflow definitions are opaque jsonb; two step shapes exist in the wild:
 * the original {type, params, onFailure:{policy,...}} and the GUI's
 * {id, type, name, params, onFailure:{action, maxAttempts, backoffSeconds}}.
 * The saga normalizes both.
 */
interface LooseStep {
  type: string;
  params?: Record<string, unknown>;
  name?: string;
  onFailure?: Record<string, unknown>;
}

interface LooseDefinition {
  steps: LooseStep[];
}

interface NormalizedOnFailure {
  policy: "retry" | "compensate" | "halt_and_alert";
  maxAttempts: number;
  backoffBaseMs: number;
  compensation: LooseStep[];
}

function normalizeOnFailure(raw: Record<string, unknown> | undefined): NormalizedOnFailure {
  const policyRaw = raw?.policy ?? raw?.action;
  const policy = policyRaw === "compensate" || policyRaw === "halt_and_alert" ? policyRaw : "retry";
  return {
    policy,
    maxAttempts: typeof raw?.maxAttempts === "number" ? raw.maxAttempts : DEFAULT_MAX_ATTEMPTS,
    backoffBaseMs: typeof raw?.backoffSeconds === "number" ? raw.backoffSeconds * 1_000 : 1_000,
    compensation: Array.isArray(raw?.compensation) ? (raw.compensation as LooseStep[]) : [],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setMissionStatus(missionId: string, status: MissionStatus): Promise<void> {
  await pool.query("UPDATE missions SET status = $2, updated_at = now() WHERE id = $1", [missionId, status]);
  await publish("mission.status", { missionId, status });
}

async function setStepStatus(stepId: string, status: string, lastError?: string): Promise<void> {
  await pool.query(
    "UPDATE mission_steps SET status = $2, last_error = COALESCE($3, last_error), updated_at = now() WHERE id = $1",
    [stepId, status, lastError ?? null],
  );
}

async function mergeSagaState(missionId: string, patch: Record<string, unknown>): Promise<void> {
  await pool.query(
    "UPDATE missions SET saga_state = saga_state || $2::jsonb, updated_at = now() WHERE id = $1",
    [missionId, JSON.stringify(patch)],
  );
}

async function loadMission(missionId: string): Promise<MissionRow | undefined> {
  const { rows } = await pool.query<MissionRow>("SELECT * FROM missions WHERE id = $1", [missionId]);
  return rows[0];
}

async function loadSteps(missionId: string): Promise<StepRow[]> {
  const { rows } = await pool.query<StepRow>(
    "SELECT id, seq, type, params, status, attempts FROM mission_steps WHERE mission_id = $1 ORDER BY seq",
    [missionId],
  );
  return rows;
}

async function loadDefinition(workflowVersionId: string): Promise<LooseDefinition> {
  const { rows } = await pool.query("SELECT definition FROM workflow_versions WHERE id = $1", [workflowVersionId]);
  const definition = rows[0]?.definition as LooseDefinition | undefined;
  return definition !== undefined && Array.isArray(definition.steps) ? definition : { steps: [] };
}

async function fleetAndRobotNames(mission: MissionRow): Promise<{ fleet?: string; robot?: string }> {
  const result: { fleet?: string; robot?: string } = {};
  if (mission.fleet_id !== null) {
    const { rows } = await pool.query<{ name: string }>("SELECT name FROM fleets WHERE id = $1", [mission.fleet_id]);
    if (rows[0] !== undefined) result.fleet = rows[0].name;
  }
  if (mission.robot_id !== null) {
    const { rows } = await pool.query<{ name: string | null; serial: string }>(
      "SELECT name, serial FROM robots WHERE id = $1",
      [mission.robot_id],
    );
    if (rows[0] !== undefined) result.robot = rows[0].name ?? rows[0].serial;
  }
  return result;
}

function placesFromParams(params: Record<string, unknown>): string[] {
  if (Array.isArray(params.places)) return params.places.filter((p): p is string => typeof p === "string");
  if (typeof params.place === "string") return [params.place];
  return [];
}

/** Executes one step body; throws on failure. Delegation vs orchestration lives here. */
async function executeStepBody(
  mission: MissionRow,
  step: Pick<StepRow, "seq" | "type" | "params">,
  control: RunnerControl,
): Promise<void> {
  const names = await fleetAndRobotNames(mission);

  switch (step.type) {
    case "goto": {
      const places = placesFromParams(step.params);
      if (places.length === 0) throw new Error("goto step has no places/place param");
      const rounds = typeof step.params.rounds === "number" ? step.params.rounds : 1;
      const taskId = await submitGotoTask(places, rounds, names.fleet, names.robot);
      await mergeSagaState(mission.id, { [`taskId:${step.seq}`]: taskId });
      await pollExternalTask(taskId, control);
      return;
    }
    case "charge": {
      const taskId = await submitChargeTask(names.fleet, names.robot);
      await mergeSagaState(mission.id, { [`taskId:${step.seq}`]: taskId });
      await pollExternalTask(taskId, control);
      return;
    }
    case "dock": {
      // Docking is executed robot-side (Nav2 docking behavior); the platform
      // only signals it via the event bus.
      await publish("robot.dock.requested", {
        missionId: mission.id,
        robotId: mission.robot_id,
        params: step.params,
      });
      return;
    }
    case "wait": {
      const seconds = typeof step.params.seconds === "number" ? step.params.seconds : 1;
      const deadline = Date.now() + seconds * 1_000;
      while (Date.now() < deadline) {
        if (control.cancelRequested) throw new CancelledError();
        await sleep(Math.min(500, deadline - Date.now()));
      }
      return;
    }
    case "capture_image":
    case "publish":
    case "call_service":
    case "custom": {
      // Platform-orchestrated: emit an executable event for the robot-side or
      // integration consumer of this step type.
      await publish("mission.step.execute", {
        missionId: mission.id,
        robotId: mission.robot_id,
        seq: step.seq,
        stepType: step.type,
        params: step.params,
      });
      return;
    }
    default:
      throw new Error(`unknown step type: ${step.type}`);
  }
}

class CancelledError extends Error {
  constructor() {
    super("mission cancelled");
  }
}

async function pollExternalTask(taskId: string, control: RunnerControl): Promise<void> {
  for (;;) {
    if (control.cancelRequested) throw new CancelledError();
    const status = await getTaskStatus(taskId);
    if (status === "completed") return;
    if (status === "failed") throw new Error(`external task ${taskId} failed`);
    if (status === "canceled") throw new Error(`external task ${taskId} was canceled`);
    await sleep(POLL_INTERVAL_MS);
  }
}

async function raiseMissionAlarm(mission: MissionRow, reason: string): Promise<void> {
  // Alarm shape matches the GUI's Alarm type (id/severity/message/robotId/raisedAt/acknowledged).
  const alarm = {
    id: `mission:${mission.id}`,
    severity: "critical",
    message: reason,
    robotId: mission.robot_id,
    raisedAt: new Date().toISOString(),
    acknowledged: false,
  };
  await cacheRedis.set(`alarms:${alarm.id}`, JSON.stringify(alarm));
  await publish("alarm.raised", { alarm });
  await publish("mission.needs_operator", { missionId: mission.id, reason });
}

async function runCompensation(mission: MissionRow, steps: LooseStep[], control: RunnerControl): Promise<void> {
  for (const [index, step] of steps.entries()) {
    try {
      await executeStepBody(mission, { seq: -(index + 1), type: step.type, params: step.params ?? {} }, control);
    } catch (err) {
      // Compensation is best-effort; a failing compensation step must not
      // mask the original failure.
      logger.error("compensation step failed", { missionId: mission.id, type: step.type, ...errorFields(err) });
    }
  }
}

async function runMission(missionId: string, control: RunnerControl): Promise<void> {
  const mission = await loadMission(missionId);
  if (mission === undefined) return;
  const definition = await loadDefinition(mission.workflow_version_id);
  await setMissionStatus(missionId, "running");

  for (;;) {
    if (control.cancelRequested) {
      await setMissionStatus(missionId, "cancelled");
      return;
    }

    const steps = await loadSteps(missionId);
    const current = steps.find((s) => ["pending", "running", "retrying"].includes(s.status));
    if (current === undefined) {
      const failed = steps.some((s) => s.status === "failed");
      await setMissionStatus(missionId, failed ? "failed" : "completed");
      await publish(failed ? "mission.failed" : "mission.completed", { missionId });
      return;
    }

    await setStepStatus(current.id, "running");
    await pool.query("UPDATE mission_steps SET attempts = attempts + 1, updated_at = now() WHERE id = $1", [
      current.id,
    ]);
    const attempts = current.attempts + 1;

    try {
      await executeStepBody(mission, current, control);
      await setStepStatus(current.id, "done");
    } catch (err) {
      if (err instanceof CancelledError) {
        await setMissionStatus(missionId, "cancelled");
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      const onFailure = normalizeOnFailure(definition.steps[current.seq]?.onFailure);

      if (onFailure.policy === "retry" && attempts < onFailure.maxAttempts) {
        await setStepStatus(current.id, "retrying", message);
        const backoff = Math.min(MAX_BACKOFF_MS, onFailure.backoffBaseMs * 2 ** (attempts - 1));
        logger.warn("step retrying", { missionId, seq: current.seq, attempts, backoff });
        await sleep(backoff);
        continue;
      }

      if (onFailure.policy === "compensate") {
        await setStepStatus(current.id, "compensating", message);
        await runCompensation(mission, onFailure.compensation, control);
        await setStepStatus(current.id, "failed", message);
        await setMissionStatus(missionId, "failed");
        await publish("mission.failed", { missionId, seq: current.seq, error: message });
        return;
      }

      // halt_and_alert, or retry exhausted: park for the operator.
      await setStepStatus(current.id, "failed", message);
      await setMissionStatus(missionId, "needs_operator");
      await raiseMissionAlarm(mission, `step ${current.seq} (${current.type}) failed: ${message}`);
      return;
    }
  }
}

export function startMissionRunner(missionId: string): void {
  if (runners.has(missionId)) return;
  const control: RunnerControl = { cancelRequested: false };
  runners.set(missionId, control);
  runMission(missionId, control)
    .catch((err) => {
      logger.error("mission runner crashed", { missionId, ...errorFields(err) });
      return setMissionStatus(missionId, "needs_operator").catch(() => undefined);
    })
    .finally(() => runners.delete(missionId));
}

export function requestCancel(missionId: string): boolean {
  const control = runners.get(missionId);
  if (control === undefined) return false;
  control.cancelRequested = true;
  return true;
}

export function isRunnerActive(missionId: string): boolean {
  return runners.has(missionId);
}

/** Resumes missions left in-flight by a previous process (crash/deploy). */
export async function resumeInFlightMissions(): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM missions WHERE status IN ('running', 'compiling')",
  );
  for (const row of rows) {
    logger.info("resuming in-flight mission", { missionId: row.id });
    startMissionRunner(row.id);
  }
}
