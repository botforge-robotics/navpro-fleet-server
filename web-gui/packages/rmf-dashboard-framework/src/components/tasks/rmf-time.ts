/**
 * RMF task/robot timestamps under Gazebo are sim-clock millis (near epoch →
 * look like 1970). Convert them to wall-clock using the offset learned from
 * live robot `unix_millis_time` vs Date.now(), then format as real dates.
 */

/** Anything before ~2001-09 is treated as sim-era (Gazebo clock). */
const WALL_CLOCK_FLOOR_MS = 1_000_000_000_000;

/** wall_ms = sim_ms + offset  (offset = Date.now() - current_sim_ms). */
let simToWallOffsetMs: number | null = null;

export function isSimEraMillis(ms: number | null | undefined): boolean {
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 && ms < WALL_CLOCK_FLOOR_MS;
}

/**
 * Learn sim→wall offset from a robot (or /clock) sim timestamp.
 * Call whenever fleets update.
 */
export function updateSimClockFromRobotTime(simUnixMillis: number | null | undefined): void {
  if (!isSimEraMillis(simUnixMillis)) {
    return;
  }
  simToWallOffsetMs = Date.now() - (simUnixMillis as number);
}

/** Convert RMF millis to wall-clock millis for display / comparisons. */
export function toWallMillis(ms: number | null | undefined): number | null {
  if (ms == null || !Number.isFinite(ms)) {
    return null;
  }
  if (!isSimEraMillis(ms)) {
    return ms;
  }
  if (simToWallOffsetMs == null) {
    return null;
  }
  return ms + simToWallOffsetMs;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Display format: dd/mm/yy, HH:mm:ss */
export function formatWallClock(ms: number): string {
  const d = new Date(ms);
  const dd = pad2(d.getDate());
  const mm = pad2(d.getMonth() + 1);
  const yy = pad2(d.getFullYear() % 100);
  const HH = pad2(d.getHours());
  const min = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `${dd}/${mm}/${yy}, ${HH}:${min}:${ss}`;
}

/** Date only: dd/mm/yy */
export function formatWallDate(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${pad2(d.getFullYear() % 100)}`;
}

/** Time only: HH:mm:ss */
export function formatWallTimeOnly(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function formatRmfTime(
  ms: number | null | undefined,
  opts?: { withDate?: boolean },
): string {
  const wall = toWallMillis(ms);
  if (wall == null) {
    return ms == null ? 'n/a' : '…';
  }
  return opts?.withDate === false ? formatWallTimeOnly(wall) : formatWallClock(wall);
}

export function formatRmfDate(ms: number | null | undefined): string {
  const wall = toWallMillis(ms);
  if (wall == null) {
    return ms == null ? 'n/a' : '…';
  }
  return formatWallDate(wall);
}

export function formatRmfTimeOnly(ms: number | null | undefined): string {
  const wall = toWallMillis(ms);
  if (wall == null) {
    return ms == null ? 'n/a' : '…';
  }
  return formatWallTimeOnly(wall);
}

/** Stable DataGrid row id when booking.id is reused (e.g. "delivery"). */
export function taskRowId(state: {
  booking?: {
    id?: string | null;
    unix_millis_request_time?: number | null;
  } | null;
  status?: string | null;
  unix_millis_start_time?: number | null;
  unix_millis_finish_time?: number | null;
  assigned_to?: { name?: string | null } | null;
  category?: string | null;
}): string {
  const b = state.booking;
  return [
    b?.id ?? 'unknown',
    b?.unix_millis_request_time ?? '',
    state.unix_millis_start_time ?? '',
    state.unix_millis_finish_time ?? '',
    state.status ?? '',
    state.assigned_to?.name ?? '',
    state.category ?? '',
  ].join('|');
}
