import Redis from "ioredis";
import { config } from "./config";

/** Live/hot data: robot state, health, alarms, ws fan-out. No durability expected. */
export const cacheRedis = new Redis(config.redisCacheUrl, { maxRetriesPerRequest: 3 });

/** Durable event bus (Redis Streams, AOF-persisted instance). */
export const streamsRedis = new Redis(config.redisStreamsUrl, { maxRetriesPerRequest: 3 });

export async function closeRedis(): Promise<void> {
  cacheRedis.disconnect();
  streamsRedis.disconnect();
}
