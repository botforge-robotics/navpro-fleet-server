import type { Device } from "../../models";
import { requestLift } from "../../workflows/rmf-tasks";
import type { DeviceHealth, DevicePlugin, DeviceStatus } from "../plugin";
import { notifyHardware } from "../hardware";

function liftName(device: Device): string {
  return typeof device.config.liftName === "string" ? device.config.liftName : device.name;
}

/** Lift/elevator: RMF call + optional HTTP/MQTT hardware adapter. */
export const liftPlugin: DevicePlugin = {
  pluginName: "lift",

  capabilities(): string[] {
    return ["call", "open", "close"];
  },

  async status(device: Device): Promise<DeviceStatus> {
    return {
      device: device.name,
      state: "unknown",
      detail: { transport: device.config.transport ?? "rmf-only" },
      ts: new Date().toISOString(),
    };
  },

  async command(device: Device, command: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const name = liftName(device);
    if (command === "call") {
      const destination = args.destination;
      if (typeof destination !== "string" || destination === "") {
        throw new Error("lift call requires args.destination (floor name)");
      }
      await requestLift(name, destination);
      const hw = await notifyHardware(device.config, "call", name);
      return { requested: command, destination, ...hw };
    }
    if (command === "open" || command === "close") {
      const hw = await notifyHardware(device.config, command, name);
      return { requested: command, ...hw };
    }
    throw new Error(`lift supports call/open/close, got "${command}"`);
  },

  async health(device: Device): Promise<DeviceHealth> {
    return { device: device.name, healthy: device.enabled, ts: new Date().toISOString() };
  },
};
