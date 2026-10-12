import type { Device } from "../../models";
import { requestDoorMode } from "../../workflows/rmf-tasks";
import type { DeviceHealth, DevicePlugin, DeviceStatus } from "../plugin";
import { notifyHardware } from "../hardware";

function doorName(device: Device): string {
  return typeof device.config.doorName === "string" ? device.config.doorName : device.name;
}

/** Door controller: RMF request + optional HTTP/MQTT hardware adapter. */
export const doorPlugin: DevicePlugin = {
  pluginName: "door",

  capabilities(): string[] {
    return ["open", "close"];
  },

  async status(device: Device): Promise<DeviceStatus> {
    return {
      device: device.name,
      state: "unknown",
      detail: { transport: device.config.transport ?? "rmf-only" },
      ts: new Date().toISOString(),
    };
  },

  async command(device: Device, command: string, _args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (command !== "open" && command !== "close") {
      throw new Error(`door supports open/close, got "${command}"`);
    }
    const name = doorName(device);
    await requestDoorMode(name, command === "open" ? "open" : "closed");
    const hw = await notifyHardware(device.config, command, name);
    return { requested: command, ...hw };
  },

  async health(device: Device): Promise<DeviceHealth> {
    return { device: device.name, healthy: device.enabled, ts: new Date().toISOString() };
  },
};
