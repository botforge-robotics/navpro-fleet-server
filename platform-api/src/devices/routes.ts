import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { HttpError, asyncHandler, notFound } from "../http/errors";
import { requireAuth, requireRole, auditMutations } from "../auth/middleware";
import { mapDevice } from "../registry/mappers";
import type { Device } from "../models";
import { getPlugin, registerPlugin } from "./plugin";
import { doorPlugin } from "./plugins/door";
import { liftPlugin } from "./plugins/lift";
import { dockPlugin } from "./plugins/dock";

registerPlugin(doorPlugin);
registerPlugin(liftPlugin);
registerPlugin(dockPlugin);

async function loadDevice(id: string): Promise<Device> {
  const { rows } = await pool.query("SELECT * FROM devices WHERE id = $1", [id]);
  if (rows[0] === undefined) throw notFound("device");
  return mapDevice(rows[0] as Record<string, unknown>);
}

function pluginFor(device: Device) {
  const plugin = getPlugin(device.plugin);
  if (plugin === undefined) throw new HttpError(501, `no plugin registered for "${device.plugin}"`);
  return plugin;
}

const commandSchema = z.object({
  command: z.string().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
});

/** DB device types -> GUI DeviceType enum. */
const GUI_TYPE_MAP: Record<string, string> = {
  door: "door",
  lift: "lift",
  dispenser: "dispenser",
  dock: "charger",
  plc: "plc",
  camera: "camera",
  custom: "custom_action",
};

function commandLabel(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, " ");
}

async function toGuiDevice(device: Device): Promise<Record<string, unknown>> {
  const plugin = getPlugin(device.plugin);
  let status: Record<string, unknown> = {};
  let health: Record<string, unknown> | null = null;
  let commands: Array<{ name: string; label: string; params: Record<string, unknown> }> = [];
  if (plugin !== undefined) {
    try {
      status = (await plugin.status(device)) as unknown as Record<string, unknown>;
    } catch {
      status = {};
    }
    try {
      health = (await plugin.health(device)) as unknown as Record<string, unknown>;
    } catch {
      health = null;
    }
    commands = plugin.capabilities(device).map((name) => ({ name, label: commandLabel(name), params: {} }));
  }
  return {
    id: device.id,
    name: device.name,
    type: GUI_TYPE_MAP[device.type] ?? device.type,
    levelId: device.levelId,
    status,
    health,
    capabilities: { commands, hasHealth: plugin !== undefined },
    config: device.config,
    plugin: device.plugin,
  };
}

export const deviceOpsRouter = Router();
deviceOpsRouter.use(requireAuth);

/** GUI device list: registry rows enriched via each device's plugin. */
deviceOpsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query("SELECT * FROM devices ORDER BY name");
    const devices = (rows as Record<string, unknown>[]).map(mapDevice);
    res.json(await Promise.all(devices.map(toGuiDevice)));
  }),
);

deviceOpsRouter.get(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const device = await loadDevice(req.params.id as string);
    const plugin = pluginFor(device);
    res.json({ ...(await plugin.status(device)), capabilities: plugin.capabilities(device) });
  }),
);

deviceOpsRouter.get(
  "/:id/health",
  asyncHandler(async (req, res) => {
    const device = await loadDevice(req.params.id as string);
    res.json(await pluginFor(device).health(device));
  }),
);

deviceOpsRouter.post(
  "/:id/command",
  requireRole("operator"),
  auditMutations,
  asyncHandler(async (req, res) => {
    const device = await loadDevice(req.params.id as string);
    if (!device.enabled) throw new HttpError(409, "device is disabled");
    const { command, args } = commandSchema.parse(req.body);
    try {
      res.json(await pluginFor(device).command(device, command, args));
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, err instanceof Error ? err.message : "device command failed");
    }
  }),
);

const linkHardwareSchema = z.object({
  transport: z.enum(["rmf-only", "http", "mqtt"]),
  endpointUrl: z.string().optional(),
  openPath: z.string().optional(),
  closePath: z.string().optional(),
  authHeader: z.string().optional(),
  topicCmd: z.string().optional(),
  topicState: z.string().optional(),
  payloadOpen: z.string().optional(),
  payloadClose: z.string().optional(),
  brokerUrl: z.string().optional(),
  doorName: z.string().optional(),
  liftName: z.string().optional(),
});

/** Attach HTTP or MQTT hardware endpoint to a registry device. */
deviceOpsRouter.patch(
  "/:id/hardware",
  requireRole("supervisor"),
  auditMutations,
  asyncHandler(async (req, res) => {
    const device = await loadDevice(req.params.id as string);
    const body = linkHardwareSchema.parse(req.body);
    const nextConfig = { ...device.config, ...body };
    const { rows } = await pool.query(
      `UPDATE devices SET config = $2::jsonb WHERE id = $1 RETURNING *`,
      [device.id, JSON.stringify(nextConfig)],
    );
    res.json(await toGuiDevice(mapDevice(rows[0] as Record<string, unknown>)));
  }),
);

/** Create a registry device row linked to an RMF door/lift name for hardware I/O. */
deviceOpsRouter.post(
  "/link",
  requireRole("supervisor"),
  auditMutations,
  asyncHandler(async (req, res) => {
    const schema = linkHardwareSchema.extend({
      name: z.string().min(1),
      type: z.enum(["door", "lift"]),
    });
    const body = schema.parse(req.body);
    const plugin = body.type;
    const config: Record<string, unknown> = {
      transport: body.transport,
      endpointUrl: body.endpointUrl,
      openPath: body.openPath,
      closePath: body.closePath,
      authHeader: body.authHeader,
      topicCmd: body.topicCmd,
      topicState: body.topicState,
      payloadOpen: body.payloadOpen,
      payloadClose: body.payloadClose,
      brokerUrl: body.brokerUrl,
    };
    if (body.type === "door") config.doorName = body.doorName ?? body.name;
    if (body.type === "lift") config.liftName = body.liftName ?? body.name;

    const { rows } = await pool.query(
      `INSERT INTO devices (name, type, plugin, config)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (name) DO UPDATE SET config = EXCLUDED.config, type = EXCLUDED.type, plugin = EXCLUDED.plugin
       RETURNING *`,
      [body.name, body.type, plugin, JSON.stringify(config)],
    );
    res.status(201).json(await toGuiDevice(mapDevice(rows[0] as Record<string, unknown>)));
  }),
);
