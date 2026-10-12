import { config } from "../config";
import { logger, errorFields } from "../logger";
import Redis from "ioredis";
import { EVENTS_DLQ_STREAM, EVENTS_STREAM } from "./bus";

export interface BusEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
}

export type EventHandler = (event: BusEvent) => Promise<void>;

export interface Consumer {
  stop(): Promise<void>;
}

const MAX_DELIVERIES = 5;
const CLAIM_MIN_IDLE_MS = 30_000;
const READ_BLOCK_MS = 5_000;
const BATCH = 10;

type StreamEntry = [id: string, fields: string[]];

function parseEntry(entry: StreamEntry): BusEvent {
  const [id, fields] = entry;
  let type = "";
  let payload: Record<string, unknown> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    if (key === "type" && value !== undefined) type = value;
    if (key === "payload" && value !== undefined) {
      try {
        payload = JSON.parse(value) as Record<string, unknown>;
      } catch {
        payload = { raw: value };
      }
    }
  }
  return { id, type, payload };
}

/**
 * Starts a consumer-group loop on navpro:events. Each service uses its own
 * group name; stuck messages are reclaimed with XAUTOCLAIM, and messages that
 * fail delivery MAX_DELIVERIES times are moved to navpro:events:dlq and acked.
 */
export function startConsumer(group: string, handler: EventHandler): Consumer {
  // Blocking XREADGROUP needs its own connection.
  const redis = new Redis(config.redisStreamsUrl, { maxRetriesPerRequest: null });
  const consumerName = `${group}-${process.pid}`;
  let running = true;

  async function ensureGroup(): Promise<void> {
    try {
      await redis.xgroup("CREATE", EVENTS_STREAM, group, "$", "MKSTREAM");
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes("BUSYGROUP")) throw err;
    }
  }

  async function deliveryCount(id: string): Promise<number> {
    const pending = (await redis.xpending(EVENTS_STREAM, group, id, id, 1)) as unknown as Array<
      [string, string, number, number]
    >;
    const entry = pending[0];
    return entry === undefined ? 0 : entry[3];
  }

  async function handleEntries(entries: StreamEntry[]): Promise<void> {
    for (const entry of entries) {
      const event = parseEntry(entry);
      const deliveries = await deliveryCount(event.id);
      if (deliveries > MAX_DELIVERIES) {
        logger.warn("moving event to DLQ", { group, id: event.id, type: event.type, deliveries });
        await redis.xadd(
          EVENTS_DLQ_STREAM,
          "*",
          "group",
          group,
          "origin_id",
          event.id,
          "type",
          event.type,
          "payload",
          JSON.stringify(event.payload),
        );
        await redis.xack(EVENTS_STREAM, group, event.id);
        continue;
      }
      try {
        await handler(event);
        await redis.xack(EVENTS_STREAM, group, event.id);
      } catch (err) {
        // Not acked: will be redelivered via XAUTOCLAIM until DLQ'd.
        logger.error("event handler failed", { group, id: event.id, type: event.type, ...errorFields(err) });
      }
    }
  }

  async function loop(): Promise<void> {
    await ensureGroup();
    while (running) {
      try {
        const claimed = (await redis.xautoclaim(
          EVENTS_STREAM,
          group,
          consumerName,
          CLAIM_MIN_IDLE_MS,
          "0-0",
          "COUNT",
          BATCH,
        )) as unknown as [string, StreamEntry[] | null];
        const claimedEntries = claimed[1] ?? [];
        if (claimedEntries.length > 0) await handleEntries(claimedEntries);

        const result = (await redis.xreadgroup(
          "GROUP",
          group,
          consumerName,
          "COUNT",
          BATCH,
          "BLOCK",
          READ_BLOCK_MS,
          "STREAMS",
          EVENTS_STREAM,
          ">",
        )) as unknown as Array<[string, StreamEntry[]]> | null;
        if (result !== null) {
          for (const [, entries] of result) await handleEntries(entries);
        }
      } catch (err) {
        if (!running) break;
        logger.error("consumer loop error", { group, ...errorFields(err) });
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
  }

  const done = loop().catch((err) => logger.error("consumer crashed", { group, ...errorFields(err) }));

  return {
    async stop(): Promise<void> {
      running = false;
      redis.disconnect();
      await done;
    },
  };
}
