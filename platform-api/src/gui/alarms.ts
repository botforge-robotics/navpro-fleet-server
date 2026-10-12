import { cacheRedis } from "../redis";
import type { GuiAlarm, GuiAlarmSeverity } from "./types";

const SEVERITIES: readonly GuiAlarmSeverity[] = ["info", "warning", "critical"];

/** Coerces whatever was stored/published into the GUI's Alarm shape. */
export function normalizeAlarm(raw: Record<string, unknown>, fallbackId: string): GuiAlarm {
  const severity = typeof raw.severity === "string" && (SEVERITIES as readonly string[]).includes(raw.severity)
    ? (raw.severity as GuiAlarmSeverity)
    : "warning";
  return {
    id: typeof raw.id === "string" ? raw.id : typeof raw.alarmId === "string" ? raw.alarmId : fallbackId,
    severity,
    message: typeof raw.message === "string" ? raw.message : typeof raw.reason === "string" ? raw.reason : "",
    robotId: typeof raw.robotId === "string" ? raw.robotId : null,
    raisedAt: typeof raw.raisedAt === "string" ? raw.raisedAt : new Date().toISOString(),
    acknowledged: raw.acknowledged === true,
  };
}

/** Reads alarms from redis-cache keys alarms:* (written by the alarms consumer). */
export async function readAlarms(activeOnly: boolean): Promise<GuiAlarm[]> {
  const keys = await cacheRedis.keys("alarms:*");
  if (keys.length === 0) return [];
  const values = await cacheRedis.mget(...keys);
  const alarms: GuiAlarm[] = [];
  for (const [i, value] of values.entries()) {
    if (value === null) continue;
    try {
      const raw = JSON.parse(value) as Record<string, unknown>;
      const alarm = normalizeAlarm(raw, (keys[i] ?? "alarms:unknown").slice("alarms:".length));
      if (activeOnly && alarm.acknowledged) continue;
      alarms.push(alarm);
    } catch {
      // skip malformed entries
    }
  }
  alarms.sort((a, b) => (a.raisedAt < b.raisedAt ? 1 : -1));
  return alarms;
}
