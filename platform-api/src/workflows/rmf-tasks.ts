/**
 * RMF-AWARE MODULE (declared exception).
 *
 * This file and src/rmf-proxy/ are the ONLY places outside the proxy allowed
 * to know RMF concepts. It builds plain JSON payloads for the RMF api-server
 * REST surface and polls task state over HTTP - no RMF SDK imports, ever.
 * The contract-boundary test excludes exactly this file; everything else in
 * src/workflows must stay platform-native.
 */
import { config } from "../config";
import { HttpError } from "../http/errors";

export type ExternalTaskStatus = "queued" | "underway" | "completed" | "failed" | "canceled" | "unknown";

interface DispatchResponse {
  state?: { booking?: { id?: string } };
  detail?: unknown;
}

async function post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${config.rmfApiServerUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new HttpError(502, `fleet coordinator rejected request (${res.status})`, await res.text());
  }
  return res.json();
}

function buildPatrolRequest(places: string[], rounds: number, fleet?: string, robot?: string): unknown {
  return {
    type: "dispatch_task_request",
    request: {
      category: "patrol",
      description: { places, rounds },
      ...(fleet !== undefined ? { fleet_name: fleet } : {}),
      ...(robot !== undefined ? { robot_name: robot } : {}),
    },
  };
}

function buildChargeRequest(fleet?: string, robot?: string): unknown {
  return {
    type: "dispatch_task_request",
    request: {
      category: "charge_battery",
      description: {},
      ...(fleet !== undefined ? { fleet_name: fleet } : {}),
      ...(robot !== undefined ? { robot_name: robot } : {}),
    },
  };
}

async function dispatch(body: unknown): Promise<string> {
  const response = (await post("/tasks/dispatch_task", body)) as DispatchResponse;
  const taskId = response.state?.booking?.id;
  if (taskId === undefined) {
    throw new HttpError(502, "fleet coordinator did not return a task id", response);
  }
  return taskId;
}

/** Submits a goto/patrol navigation task; returns the external task id to poll. */
export async function submitGotoTask(
  places: string[],
  rounds: number,
  fleet?: string,
  robot?: string,
): Promise<string> {
  return dispatch(buildPatrolRequest(places, rounds, fleet, robot));
}

/** Submits a charge task; returns the external task id to poll. */
export async function submitChargeTask(fleet?: string, robot?: string): Promise<string> {
  return dispatch(buildChargeRequest(fleet, robot));
}

/** Polls the external coordinator for the state of a previously submitted task. */
export async function getTaskStatus(taskId: string): Promise<ExternalTaskStatus> {
  const res = await fetch(`${config.rmfApiServerUrl}/tasks/${encodeURIComponent(taskId)}/state`);
  if (!res.ok) return "unknown";
  const state = (await res.json()) as { status?: string };
  switch (state.status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "canceled":
    case "killed":
      return "canceled";
    case "queued":
    case "standby":
      return "queued";
    case "underway":
    case "assigned":
      return "underway";
    default:
      return "unknown";
  }
}

/** Requests a door open/close through the coordinator's door endpoint. */
export async function requestDoorMode(doorName: string, mode: "open" | "closed"): Promise<void> {
  await post(`/doors/${encodeURIComponent(doorName)}/request`, { mode: mode === "open" ? 2 : 0 });
}

/** Requests a lift to a destination floor through the coordinator's lift endpoint. */
export async function requestLift(liftName: string, destination: string): Promise<void> {
  await post(`/lifts/${encodeURIComponent(liftName)}/request`, {
    request_type: 1,
    door_mode: 2,
    destination,
  });
}
