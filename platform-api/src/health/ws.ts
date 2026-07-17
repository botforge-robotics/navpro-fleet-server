import type { IncomingMessage, Server } from "http";
import type { Duplex } from "stream";
import { WebSocketServer, WebSocket } from "ws";
import { verifyToken } from "../auth/jwt";
import { logger, errorFields } from "../logger";
import { fetchGuiRobots } from "../gui/robot-view";
import { normalizeAlarm } from "../gui/alarms";
import { startConsumer, type Consumer } from "../events/consumer";

const PUSH_INTERVAL_MS = 1_000;
export const WS_PATH = "/api/v1/ws";

interface ClientSub {
  socket: WebSocket;
  /** null = all fleets (GUI "fleet_state" channel); string = legacy per-fleet filter. */
  fleet: string | null;
}

/**
 * Live state/health push channel for GUI clients. Clients authenticate with
 * ?token=<jwt> (or an Authorization header). Two subscribe formats are
 * accepted:
 *   {"op":"subscribe","channel":"fleet_state"}   (GUI)
 *   {"type":"subscribe","fleet":"<fleetName>"}   (legacy, per-fleet filter)
 * The server pushes:
 *   {"type":"robot_state","robots":Robot[]}      every second (enriched shape)
 *   {"type":"alarm","alarm":Alarm}               on alarm.raised/cleared events
 */
export function attachHealthWebsocket(server: Server): { wss: WebSocketServer; stop(): void } {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<ClientSub>();

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== WS_PATH) return; // other upgrades (rmf proxy) handled elsewhere

    const headerToken = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice("Bearer ".length)
      : undefined;
    const token = url.searchParams.get("token") ?? headerToken;
    if (token === null || token === undefined) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    try {
      verifyToken(token);
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (socket: WebSocket) => {
    const sub: ClientSub = { socket, fleet: null };
    clients.add(sub);
    socket.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as {
          op?: string;
          channel?: string;
          type?: string;
          fleet?: string | null;
        };
        if (msg.op === "subscribe" && msg.channel === "fleet_state") {
          sub.fleet = null;
        } else if (msg.type === "subscribe") {
          sub.fleet = typeof msg.fleet === "string" ? msg.fleet : null;
        }
      } catch {
        socket.send(JSON.stringify({ type: "error", error: "invalid JSON message" }));
      }
    });
    socket.on("close", () => clients.delete(sub));
  });

  const timer = setInterval(() => {
    if (clients.size === 0) return;
    void pushRobotState(clients).catch((err) => logger.error("ws push failed", errorFields(err)));
  }, PUSH_INTERVAL_MS);

  // Push alarm events as they fire on the bus.
  const alarmConsumer: Consumer = startConsumer("platform-ws-alarms", async (event) => {
    if (event.type !== "alarm.raised" && event.type !== "alarm.cleared") return;
    const raw = (event.payload.alarm ?? event.payload) as Record<string, unknown>;
    const alarm = normalizeAlarm(raw, event.id);
    if (event.type === "alarm.cleared") alarm.acknowledged = true;
    const message = JSON.stringify({ type: "alarm", alarm });
    for (const client of clients) {
      if (client.socket.readyState === WebSocket.OPEN) client.socket.send(message);
    }
  });

  return {
    wss,
    stop: () => {
      clearInterval(timer);
      void alarmConsumer.stop();
      for (const client of clients) client.socket.close();
      wss.close();
    },
  };
}

async function pushRobotState(clients: Set<ClientSub>): Promise<void> {
  const entries = await fetchGuiRobots();
  for (const client of clients) {
    if (client.socket.readyState !== WebSocket.OPEN) continue;
    const robots = (client.fleet === null ? entries : entries.filter((e) => e.fleetName === client.fleet)).map(
      (e) => e.robot,
    );
    client.socket.send(JSON.stringify({ type: "robot_state", robots }));
  }
}
