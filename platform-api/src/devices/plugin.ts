import type { Device } from "../models";

export interface DeviceStatus {
  device: string;
  state: string;
  detail?: Record<string, unknown>;
  ts: string;
}

export interface DeviceHealth {
  device: string;
  healthy: boolean;
  detail?: Record<string, unknown>;
  ts: string;
}

/**
 * Generic device plugin contract. The GUI renders every device from these
 * four methods, so new device types require no UI changes.
 */
export interface DevicePlugin {
  readonly pluginName: string;
  capabilities(device: Device): string[];
  status(device: Device): Promise<DeviceStatus>;
  command(device: Device, command: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
  health(device: Device): Promise<DeviceHealth>;
}

const plugins = new Map<string, DevicePlugin>();

export function registerPlugin(plugin: DevicePlugin): void {
  plugins.set(plugin.pluginName, plugin);
}

export function getPlugin(name: string): DevicePlugin | undefined {
  return plugins.get(name);
}
