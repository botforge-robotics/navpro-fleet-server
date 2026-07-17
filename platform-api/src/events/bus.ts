import { pool } from "../db/pool";
import { logger, errorFields } from "../logger";
import { streamsRedis } from "../redis";

export const EVENTS_STREAM = "navpro:events";
export const EVENTS_DLQ_STREAM = "navpro:events:dlq";

/**
 * Publishes a domain event: XADD to the durable stream for consumers, and
 * INSERT into the events table as the durable archive.
 */
export async function publish(type: string, payload: Record<string, unknown>): Promise<void> {
  const json = JSON.stringify(payload);
  try {
    await streamsRedis.xadd(EVENTS_STREAM, "*", "type", type, "payload", json);
  } catch (err) {
    logger.error("event XADD failed", { type, ...errorFields(err) });
  }
  try {
    await pool.query("INSERT INTO events (type, payload) VALUES ($1, $2)", [type, json]);
  } catch (err) {
    logger.error("event archive insert failed", { type, ...errorFields(err) });
  }
}
