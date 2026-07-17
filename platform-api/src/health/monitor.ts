import { cacheRedis } from "../redis";
import { publish } from "../events/bus";
import { logger, errorFields } from "../logger";
import { ONLINE_SET_KEY } from "./routes";

const SWEEP_INTERVAL_MS = 5_000;

/**
 * Detects robot.offline transitions: a robot is online while its health key
 * (10s TTL, refreshed by heartbeats) exists; once it expires the robot is
 * removed from the online set and an event is emitted.
 */
export function startOfflineMonitor(): { stop(): void } {
  const timer = setInterval(() => {
    void (async () => {
      try {
        const members = await cacheRedis.smembers(ONLINE_SET_KEY);
        for (const robotId of members) {
          const exists = await cacheRedis.exists(`robot:${robotId}:health`);
          if (exists === 0) {
            await cacheRedis.srem(ONLINE_SET_KEY, robotId);
            await publish("robot.offline", { robotId });
          }
        }
      } catch (err) {
        logger.error("offline monitor sweep failed", errorFields(err));
      }
    })();
  }, SWEEP_INTERVAL_MS);
  return { stop: () => clearInterval(timer) };
}
