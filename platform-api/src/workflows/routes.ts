import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { cacheRedis } from "../redis";
import { HttpError, asyncHandler, notFound } from "../http/errors";
import { requireAuth, requireRole, auditMutations } from "../auth/middleware";
import { publish } from "../events/bus";
import type { GuiMission, GuiMissionStep, GuiMissionStepState, GuiOnFailurePolicy, GuiWorkflowStep, GuiWorkflowVersion } from "../gui/types";
import { isRunnerActive, requestCancel, startMissionRunner } from "./saga";

// Workflow definitions are stored as opaque jsonb. Both step shapes are
// accepted on write (original {onFailure:{policy}} and GUI {onFailure:{action}})
// and normalized to the GUI shape on read.

const stepSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    id: z.string().optional(),
    type: z.enum(["goto", "wait", "capture_image", "publish", "call_service", "dock", "charge", "custom"]),
    name: z.string().optional(),
    params: z.record(z.string(), z.unknown()).default({}),
    onFailure: z
      .union([
        z.object({
          policy: z.enum(["retry", "compensate", "halt_and_alert"]),
          maxAttempts: z.number().int().positive().optional(),
          compensation: z.array(stepSchema).optional(),
        }),
        z.object({
          action: z.enum(["retry", "compensate", "halt_and_alert"]),
          maxAttempts: z.number().int().positive().optional(),
          backoffSeconds: z.number().nonnegative().optional(),
        }),
      ])
      .optional(),
  }),
);

const definitionSchema = z.object({ steps: z.array(stepSchema).min(1) });

const workflowCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  definition: definitionSchema.optional(),
});

interface LooseStep {
  id?: string;
  type?: string;
  name?: string;
  params?: Record<string, unknown>;
  onFailure?: Record<string, unknown>;
}

function toGuiOnFailure(raw: Record<string, unknown> | undefined): GuiOnFailurePolicy {
  const policy = raw?.policy ?? raw?.action;
  if (policy === "compensate") return { action: "compensate" };
  if (policy === "halt_and_alert") return { action: "halt_and_alert" };
  return {
    action: "retry",
    maxAttempts: typeof raw?.maxAttempts === "number" ? raw.maxAttempts : 3,
    backoffSeconds: typeof raw?.backoffSeconds === "number" ? raw.backoffSeconds : 1,
  };
}

function toGuiSteps(definition: unknown): GuiWorkflowStep[] {
  const steps = Array.isArray((definition as { steps?: unknown })?.steps)
    ? ((definition as { steps: LooseStep[] }).steps)
    : [];
  return steps.map((step, index) => {
    const params = step.params ?? {};
    const paramName = typeof params.name === "string" ? params.name : undefined;
    return {
      id: step.id ?? `s${index}`,
      type: step.type ?? "custom",
      name: step.name ?? paramName ?? step.type ?? "step",
      params,
      onFailure: toGuiOnFailure(step.onFailure),
    };
  });
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : new Date(0).toISOString();
}

function toGuiWorkflowVersion(row: Record<string, unknown>): GuiWorkflowVersion {
  return {
    id: String(row.id),
    workflowId: String(row.workflow_id),
    version: Number(row.version),
    steps: toGuiSteps(row.definition),
    author: typeof row.created_by === "string" ? row.created_by : "",
    createdAt: iso(row.created_at),
  };
}

export const workflowsRouter = Router();
workflowsRouter.use(requireAuth);

workflowsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT w.id, w.name, w.description, w.created_at,
              COALESCE((SELECT max(version) FROM workflow_versions v WHERE v.workflow_id = w.id), 0) AS latest_version,
              COALESCE((SELECT max(created_at) FROM workflow_versions v WHERE v.workflow_id = w.id), w.created_at) AS updated_at
       FROM workflows w ORDER BY w.created_at DESC`,
    );
    res.json(
      (rows as Record<string, unknown>[]).map((row) => ({
        id: row.id,
        name: row.name,
        description: typeof row.description === "string" ? row.description : "",
        latestVersion: Number(row.latest_version),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
      })),
    );
  }),
);

workflowsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT w.id, w.name, w.description, w.created_at,
              COALESCE((SELECT max(version) FROM workflow_versions v WHERE v.workflow_id = w.id), 0) AS latest_version,
              COALESCE((SELECT max(created_at) FROM workflow_versions v WHERE v.workflow_id = w.id), w.created_at) AS updated_at
       FROM workflows w WHERE w.id = $1`,
      [req.params.id],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) throw notFound("workflow");
    res.json({
      id: row.id,
      name: row.name,
      description: typeof row.description === "string" ? row.description : "",
      latestVersion: Number(row.latest_version),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    });
  }),
);

workflowsRouter.get(
  "/:id/versions",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT * FROM workflow_versions WHERE workflow_id = $1 ORDER BY version",
      [req.params.id],
    );
    res.json((rows as Record<string, unknown>[]).map(toGuiWorkflowVersion));
  }),
);

workflowsRouter.post(
  "/",
  requireRole("operator"),
  auditMutations,
  asyncHandler(async (req, res) => {
    const body = workflowCreateSchema.parse(req.body);
    const createdBy = req.auth?.username ?? null;
    const { rows } = await pool.query(
      "INSERT INTO workflows (name, description, created_by) VALUES ($1, $2, $3) RETURNING *",
      [body.name, body.description ?? null, createdBy],
    );
    const workflow = rows[0] as { id: string };
    if (body.definition !== undefined) {
      await pool.query(
        "INSERT INTO workflow_versions (workflow_id, version, definition, created_by) VALUES ($1, 1, $2, $3)",
        [workflow.id, JSON.stringify(body.definition), createdBy],
      );
    }
    res.status(201).json(rows[0]);
  }),
);

workflowsRouter.post(
  "/:id/versions",
  requireRole("operator"),
  auditMutations,
  asyncHandler(async (req, res) => {
    // Accept either {definition:{steps}} or the GUI's bare {steps:[...]}.
    const body = req.body as { definition?: unknown; steps?: unknown };
    const definition = definitionSchema.parse(body.definition ?? { steps: body.steps ?? [] });
    const { rows: wf } = await pool.query("SELECT id FROM workflows WHERE id = $1", [req.params.id]);
    if (wf[0] === undefined) throw notFound("workflow");
    const { rows } = await pool.query(
      `INSERT INTO workflow_versions (workflow_id, version, definition, created_by)
       VALUES ($1, COALESCE((SELECT max(version) FROM workflow_versions WHERE workflow_id = $1), 0) + 1, $2, $3)
       RETURNING *`,
      [req.params.id, JSON.stringify(definition), req.auth?.username ?? null],
    );
    res.status(201).json(toGuiWorkflowVersion(rows[0] as Record<string, unknown>));
  }),
);

workflowsRouter.delete(
  "/:id",
  requireRole("supervisor"),
  auditMutations,
  asyncHandler(async (req, res) => {
    const { rowCount } = await pool.query("DELETE FROM workflows WHERE id = $1", [req.params.id]);
    if (rowCount === 0) throw notFound("workflow");
    res.status(204).end();
  }),
);

// ---- Missions ----

const missionSubmitSchema = z.object({
  workflowId: z.string().uuid(),
  version: z.number().int().positive().optional(),
  fleet: z.string().min(1),
  robot: z.string().optional(),
});

const STEP_STATE_MAP: Record<string, GuiMissionStepState> = {
  pending: "pending",
  running: "running",
  retrying: "retrying",
  compensating: "compensating",
  done: "succeeded",
  failed: "failed",
  skipped: "skipped",
};

const TERMINAL_STEP_STATES: readonly GuiMissionStepState[] = ["succeeded", "failed", "skipped", "compensated"];

function toGuiMissionStep(row: Record<string, unknown>): GuiMissionStep {
  const params = row.params !== null && typeof row.params === "object" ? (row.params as Record<string, unknown>) : {};
  const state = STEP_STATE_MAP[String(row.status)] ?? "pending";
  return {
    id: String(row.id),
    missionId: String(row.mission_id),
    index: Number(row.seq),
    type: String(row.type),
    name: typeof params.name === "string" ? params.name : String(row.type),
    state,
    attempts: Number(row.attempts ?? 0),
    error: typeof row.last_error === "string" ? row.last_error : null,
    startedAt: null, // per-step start times are not tracked
    finishedAt: TERMINAL_STEP_STATES.includes(state) ? iso(row.updated_at) : null,
  };
}

function toGuiMission(row: Record<string, unknown>, steps: GuiMissionStep[]): GuiMission {
  const status = String(row.status);
  return {
    id: String(row.id),
    workflowId: String(row.workflow_id),
    workflowVersion: Number(row.workflow_version),
    fleetId: typeof row.fleet_id === "string" ? row.fleet_id : "",
    robotId: typeof row.robot_id === "string" ? row.robot_id : null,
    status: status === "compiling" ? "pending" : (status as GuiMission["status"]),
    steps,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

const MISSION_SELECT = `
  SELECT m.*, wv.workflow_id, wv.version AS workflow_version
  FROM missions m
  JOIN workflow_versions wv ON wv.id = m.workflow_version_id`;

async function stepsByMission(missionIds: string[]): Promise<Map<string, GuiMissionStep[]>> {
  const grouped = new Map<string, GuiMissionStep[]>();
  if (missionIds.length === 0) return grouped;
  const { rows } = await pool.query(
    "SELECT * FROM mission_steps WHERE mission_id = ANY($1::uuid[]) ORDER BY mission_id, seq",
    [missionIds],
  );
  for (const row of rows as Record<string, unknown>[]) {
    const step = toGuiMissionStep(row);
    const list = grouped.get(step.missionId) ?? [];
    list.push(step);
    grouped.set(step.missionId, list);
  }
  return grouped;
}

export const missionsRouter = Router();
missionsRouter.use(requireAuth);

missionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const { rows } =
      status !== undefined
        ? await pool.query(`${MISSION_SELECT} WHERE m.status = $1 ORDER BY m.created_at DESC LIMIT 200`, [status])
        : await pool.query(`${MISSION_SELECT} ORDER BY m.created_at DESC LIMIT 200`);
    const missionRows = rows as Record<string, unknown>[];
    const steps = await stepsByMission(missionRows.map((r) => String(r.id)));
    res.json(missionRows.map((row) => toGuiMission(row, steps.get(String(row.id)) ?? [])));
  }),
);

missionsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`${MISSION_SELECT} WHERE m.id = $1`, [req.params.id]);
    const row = rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) throw notFound("mission");
    const steps = await stepsByMission([String(row.id)]);
    res.json(toGuiMission(row, steps.get(String(row.id)) ?? []));
  }),
);

missionsRouter.post(
  "/",
  requireRole("operator"),
  auditMutations,
  asyncHandler(async (req, res) => {
    const body = missionSubmitSchema.parse(req.body);

    const versionQuery =
      body.version !== undefined
        ? pool.query("SELECT id, version, definition FROM workflow_versions WHERE workflow_id = $1 AND version = $2", [
            body.workflowId,
            body.version,
          ])
        : pool.query(
            "SELECT id, version, definition FROM workflow_versions WHERE workflow_id = $1 ORDER BY version DESC LIMIT 1",
            [body.workflowId],
          );
    const { rows: versionRows } = await versionQuery;
    const workflowVersion = versionRows[0] as
      | { id: string; version: number; definition: { steps?: LooseStep[] } }
      | undefined;
    if (workflowVersion === undefined) throw notFound("workflow version");

    const { rows: fleetRows } = await pool.query("SELECT id FROM fleets WHERE name = $1 OR id::text = $1", [
      body.fleet,
    ]);
    const fleet = fleetRows[0] as { id: string } | undefined;
    if (fleet === undefined) throw notFound("fleet");

    let robotId: string | null = null;
    if (body.robot !== undefined) {
      const { rows: robotRows } = await pool.query(
        "SELECT id FROM robots WHERE (name = $1 OR serial = $1 OR id::text = $1) AND fleet_id = $2",
        [body.robot, fleet.id],
      );
      const robot = robotRows[0] as { id: string } | undefined;
      if (robot === undefined) throw notFound("robot");
      robotId = robot.id;
    }

    const { rows: missionRows } = await pool.query(
      `INSERT INTO missions (workflow_version_id, robot_id, fleet_id, status, created_by)
       VALUES ($1, $2, $3, 'compiling', $4) RETURNING *`,
      [workflowVersion.id, robotId, fleet.id, req.auth?.username ?? null],
    );
    const mission = missionRows[0] as { id: string };

    // Compile: one mission_steps row per workflow step. The GUI step name is
    // preserved in params so the mission view can display it.
    const steps = workflowVersion.definition.steps ?? [];
    for (const [seq, step] of steps.entries()) {
      const params: Record<string, unknown> = { ...(step.params ?? {}) };
      if (typeof step.name === "string" && params.name === undefined) params.name = step.name;
      await pool.query(
        "INSERT INTO mission_steps (mission_id, seq, type, params) VALUES ($1, $2, $3, $4)",
        [mission.id, seq, step.type ?? "custom", JSON.stringify(params)],
      );
    }

    await publish("mission.submitted", { missionId: mission.id, workflowId: body.workflowId });
    startMissionRunner(mission.id);

    const { rows: createdRows } = await pool.query(`${MISSION_SELECT} WHERE m.id = $1`, [mission.id]);
    const stepMap = await stepsByMission([mission.id]);
    res.status(201).json(toGuiMission(createdRows[0] as Record<string, unknown>, stepMap.get(mission.id) ?? []));
  }),
);

async function clearMissionAlarm(missionId: string): Promise<void> {
  await cacheRedis.del(`alarms:mission:${missionId}`);
  await publish("alarm.cleared", { alarm: { id: `mission:${missionId}`, acknowledged: true } });
}

missionsRouter.post(
  "/:id/cancel",
  requireRole("operator"),
  auditMutations,
  asyncHandler(async (req, res) => {
    const missionId = req.params.id as string;
    const { rows } = await pool.query<{ status: string }>("SELECT status FROM missions WHERE id = $1", [missionId]);
    if (rows[0] === undefined) throw notFound("mission");
    if (["completed", "failed", "cancelled"].includes(rows[0].status)) {
      throw new HttpError(409, `mission already ${rows[0].status}`);
    }
    const runnerNotified = requestCancel(missionId);
    if (!runnerNotified) {
      await pool.query("UPDATE missions SET status = 'cancelled', updated_at = now() WHERE id = $1", [missionId]);
      await publish("mission.status", { missionId, status: "cancelled" });
    }
    res.json({ ok: true });
  }),
);

missionsRouter.post(
  "/:id/retry",
  requireRole("operator"),
  auditMutations,
  asyncHandler(async (req, res) => {
    const missionId = req.params.id as string;
    const { rows } = await pool.query<{ status: string }>("SELECT status FROM missions WHERE id = $1", [missionId]);
    if (rows[0] === undefined) throw notFound("mission");
    if (!["needs_operator", "failed"].includes(rows[0].status)) {
      throw new HttpError(409, `mission is ${rows[0].status}, only needs_operator/failed can be retried`);
    }
    await pool.query(
      `UPDATE mission_steps SET status = 'pending', attempts = 0, updated_at = now()
       WHERE mission_id = $1 AND status IN ('failed', 'retrying', 'compensating')`,
      [missionId],
    );
    await clearMissionAlarm(missionId);
    startMissionRunner(missionId);
    res.json({ ok: true });
  }),
);

missionsRouter.post(
  "/:id/skip-step",
  requireRole("operator"),
  auditMutations,
  asyncHandler(async (req, res) => {
    const missionId = req.params.id as string;
    if (isRunnerActive(missionId)) {
      throw new HttpError(409, "mission runner is active; cancel or wait for needs_operator before skipping");
    }
    const { rows } = await pool.query(
      `UPDATE mission_steps SET status = 'skipped', updated_at = now()
       WHERE id = (SELECT id FROM mission_steps WHERE mission_id = $1
                   AND status IN ('pending', 'running', 'retrying', 'failed') ORDER BY seq LIMIT 1)
       RETURNING seq`,
      [missionId],
    );
    if (rows[0] === undefined) throw notFound("skippable step");
    await clearMissionAlarm(missionId);
    startMissionRunner(missionId);
    res.json({ ok: true, skippedSeq: (rows[0] as { seq: number }).seq });
  }),
);
