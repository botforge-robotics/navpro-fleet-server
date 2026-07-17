import { getToken } from './auth';
import type { Alarm, Robot } from './types';

// Websocket client for /api/v1/ws with exponential-backoff reconnect.
// On open it subscribes to the fleet live-state channel; the server pushes
// robot state snapshots/deltas and alarm events.
//
// Assumed wire protocol (JSON):
//   client -> { "op": "subscribe", "channel": "fleet_state" }
//   server -> { "type": "robot_state", "robots": Robot[] }
//   server -> { "type": "alarm", "alarm": Alarm }

export type FleetWsMessage =
  | { type: 'robot_state'; robots: Robot[] }
  | { type: 'alarm'; alarm: Alarm };

type MessageListener = (msg: FleetWsMessage) => void;
type StatusListener = (connected: boolean) => void;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

export class FleetWebSocket {
  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;
  private readonly messageListeners = new Set<MessageListener>();
  private readonly statusListeners = new Set<StatusListener>();

  connect(): void {
    this.closedByUser = false;
    // Singleton shared by multiple hooks: ignore if already open/connecting.
    if (
      this.ws !== null &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.open();
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private open(): void {
    const token = getToken();
    if (token === null) return;

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    // Token as query param: browsers cannot set headers on websocket upgrade.
    const url = `${proto}://${window.location.host}/api/v1/ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      ws.send(JSON.stringify({ op: 'subscribe', channel: 'fleet_state' }));
      this.statusListeners.forEach((l) => l(true));
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      let msg: FleetWsMessage;
      try {
        msg = JSON.parse(event.data) as FleetWsMessage;
      } catch {
        return;
      }
      this.messageListeners.forEach((l) => l(msg));
    };

    ws.onclose = () => {
      this.statusListeners.forEach((l) => l(false));
      if (!this.closedByUser) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private scheduleReconnect(): void {
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempt,
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }
}

export const fleetWs = new FleetWebSocket();
