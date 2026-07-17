import { publish } from "../../events/bus";
import type { Device } from "../../models";
import type { DeviceHealth, DevicePlugin, DeviceStatus } from "../plugin";

/**
 * Dock/charger: docking is executed by the robot itself (Nav2 docking
 * behavior); the platform only signals the request over the event bus.
 */
export const dockPlugin: DevicePlugin = {
  pluginName: "dock",

  capabilities(): string[] {
    return ["dock", "undock"];
  },

  async status(device: Device): Promise<DeviceStatus> {
    return { device: device.name, state: "unknown", ts: new Date().toISOString() };
  },

  async command(device: Device, command: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (command !== "dock" && command !== "undock") {
      throw new Error(`dock supports dock/undock, got "${command}"`);
    }
    const robotId = typeof args.robotId === "string" ? args.robotId : null;
    await publish(command === "dock" ? "robot.dock.requested" : "robot.undock.requested", {
      deviceId: device.id,
      deviceName: device.name,
      robotId,
      waypoint: device.config.waypoint ?? null,
    });
    return { requested: command, robotId };
  },

  async health(device: Device): Promise<DeviceHealth> {
    return { device: device.name, healthy: device.enabled, ts: new Date().toISOString() };
  },
};
