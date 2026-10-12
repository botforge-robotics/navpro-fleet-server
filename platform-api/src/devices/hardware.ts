/**
 * Shared hardware transport for door/lift plugins.
 * Device.config.transport: "http" | "mqtt" | "rmf-only" (default).
 */

import { logger, errorFields } from "../logger";

export interface HttpTransportConfig {
  transport: "http";
  endpointUrl: string;
  openPath?: string;
  closePath?: string;
  authHeader?: string;
  method?: string;
}

export interface MqttTransportConfig {
  transport: "mqtt";
  topicCmd: string;
  topicState?: string;
  payloadOpen?: string;
  payloadClose?: string;
  brokerUrl?: string;
}

async function publishMqtt(cfg: MqttTransportConfig, payload: string): Promise<void> {
  if (!cfg.topicCmd) throw new Error("mqtt transport requires config.topicCmd");
  const brokerUrl = cfg.brokerUrl ?? process.env.MQTT_BROKER_URL ?? "mqtt://mosquitto:1883";
  const mqtt = await import("mqtt");
  await new Promise<void>((resolve, reject) => {
    const client = mqtt.connect(brokerUrl, { connectTimeout: 5000 });
    const timer = setTimeout(() => {
      client.end(true);
      reject(new Error("mqtt connect timeout"));
    }, 8000);
    client.on("connect", () => {
      client.publish(cfg.topicCmd, payload, { qos: 1 }, (err) => {
        clearTimeout(timer);
        client.end(true);
        if (err) reject(err);
        else resolve();
      });
    });
    client.on("error", (err) => {
      clearTimeout(timer);
      client.end(true);
      reject(err);
    });
  });
}

async function callHttp(cfg: HttpTransportConfig, action: string, name: string): Promise<void> {
  if (!cfg.endpointUrl) throw new Error("http transport requires config.endpointUrl");
  const pathSuffix =
    action === "open" || action === "call" ? (cfg.openPath ?? "") : (cfg.closePath ?? "");
  const url = `${cfg.endpointUrl.replace(/\/$/, "")}${pathSuffix}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.authHeader) headers.Authorization = cfg.authHeader;
  const resp = await fetch(url, {
    method: cfg.method ?? "POST",
    headers,
    body: JSON.stringify({ action, name }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`hardware HTTP ${resp.status}: ${text}`);
  }
}

/**
 * Hardware side effect after RMF request.
 * Throws for misconfigured http/mqtt; no-op for rmf-only.
 */
export async function notifyHardware(
  deviceConfig: Record<string, unknown>,
  action: string,
  name: string,
): Promise<{ transport: string; notified: boolean }> {
  const transport = typeof deviceConfig.transport === "string" ? deviceConfig.transport : "rmf-only";
  try {
    if (transport === "http") {
      const cfg: HttpTransportConfig = {
        transport: "http",
        endpointUrl: String(deviceConfig.endpointUrl ?? ""),
        openPath: typeof deviceConfig.openPath === "string" ? deviceConfig.openPath : undefined,
        closePath: typeof deviceConfig.closePath === "string" ? deviceConfig.closePath : undefined,
        authHeader: typeof deviceConfig.authHeader === "string" ? deviceConfig.authHeader : undefined,
        method: typeof deviceConfig.method === "string" ? deviceConfig.method : "POST",
      };
      await callHttp(cfg, action, name);
      return { transport: "http", notified: true };
    }
    if (transport === "mqtt") {
      const cfg: MqttTransportConfig = {
        transport: "mqtt",
        topicCmd: String(deviceConfig.topicCmd ?? ""),
        topicState: typeof deviceConfig.topicState === "string" ? deviceConfig.topicState : undefined,
        payloadOpen: typeof deviceConfig.payloadOpen === "string" ? deviceConfig.payloadOpen : undefined,
        payloadClose: typeof deviceConfig.payloadClose === "string" ? deviceConfig.payloadClose : undefined,
        brokerUrl: typeof deviceConfig.brokerUrl === "string" ? deviceConfig.brokerUrl : undefined,
      };
      const payload =
        action === "open" || action === "call"
          ? (cfg.payloadOpen ?? JSON.stringify({ action, name }))
          : (cfg.payloadClose ?? JSON.stringify({ action, name }));
      await publishMqtt(cfg, payload);
      return { transport: "mqtt", notified: true };
    }
    return { transport, notified: false };
  } catch (err) {
    logger.error("hardware notify failed", { ...errorFields(err), action, name });
    throw err;
  }
}
