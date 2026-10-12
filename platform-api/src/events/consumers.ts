import { logger } from "../logger";
import { cacheRedis } from "../redis";
import { startConsumer, type Consumer } from "./consumer";

const ALARM_TTL_SECONDS = 24 * 60 * 60;

/**
 * Built-in consumers:
 * - logger: structured log line per event (the durable archive row is written
 *   at publish time in bus.ts, so this consumer is observation-only).
 * - alarms: materializes alarm events into redis-cache keys alarms:<id> that
 *   the GUI reads for the active-alarms panel.
 */
export function startBuiltinConsumers(): Consumer[] {
  const loggerConsumer = startConsumer("platform-logger", async (event) => {
    logger.info("event", { eventId: event.id, type: event.type, payload: event.payload });
  });

  // Alarm events carry {alarm: {id, severity, message, robotId, raisedAt, acknowledged}}
  // (the GUI's Alarm shape); the consumer materializes them under alarms:<id>.
  const alarmsConsumer = startConsumer("platform-alarms", async (event) => {
    if (event.type !== "alarm.raised" && event.type !== "alarm.cleared") return;
    const raw = (event.payload.alarm ?? event.payload) as Record<string, unknown>;
    const alarmId =
      typeof raw.id === "string" ? raw.id : typeof raw.alarmId === "string" ? raw.alarmId : event.id;
    const key = `alarms:${alarmId}`;
    if (event.type === "alarm.raised") {
      const alarm = {
        id: alarmId,
        severity: typeof raw.severity === "string" ? raw.severity : "warning",
        message: typeof raw.message === "string" ? raw.message : "",
        robotId: typeof raw.robotId === "string" ? raw.robotId : null,
        raisedAt: typeof raw.raisedAt === "string" ? raw.raisedAt : new Date().toISOString(),
        acknowledged: false,
      };
      await cacheRedis.set(key, JSON.stringify(alarm));
      await cacheRedis.expire(key, ALARM_TTL_SECONDS);
    } else {
      await cacheRedis.del(key);
    }
  });

  return [loggerConsumer, alarmsConsumer];
}
