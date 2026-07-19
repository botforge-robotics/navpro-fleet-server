import { Router } from "express";
import { z } from "zod";
import { config } from "../config";
import { pool } from "../db/pool";
import { HttpError, asyncHandler } from "../http/errors";
import { writeAudit } from "../auth/middleware";
import { publish } from "../events/bus";
import { mapRobot } from "./mappers";

const registerSchema = z
  .object({
    serial: z.string().min(1),
    name: z.string().optional(),
    mac: z.string().optional(),
    wifiSsid: z.string().optional(),
    fleetName: z.string().optional(),
    levelName: z.string().optional(),
    /** Captive-portal aliases (pre-fix clients). */
    fleet: z.string().optional(),
    level: z.string().optional(),
    firmwareVersion: z.string().optional(),
    firmware_version: z.string().optional(),
    piVersion: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    batterySpec: z.record(z.string(), z.unknown()).optional(),
  })
  .transform((body) => ({
    serial: body.serial,
    name: body.name,
    mac: body.mac,
    wifiSsid: body.wifiSsid,
    fleetName: body.fleetName ?? body.fleet,
    levelName: body.levelName ?? body.level,
    firmwareVersion: body.firmwareVersion ?? body.firmware_version,
    piVersion: body.piVersion,
    capabilities: body.capabilities,
    batterySpec: body.batterySpec,
  }));

export function requireProvisioningToken(token: string | undefined): void {
  if (token === undefined || token !== config.provisioningToken) {
    throw new HttpError(401, "invalid provisioning token");
  }
}

export const registerRouter = Router();

/**
 * Robot self-registration during first-boot provisioning. Upserts by serial;
 * once both fleet and level are assigned an unprovisioned robot becomes active.
 */
registerRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    requireProvisioningToken(req.header("X-Provisioning-Token"));
    const body = registerSchema.parse(req.body);

    const fleetId =
      body.fleetName !== undefined
        ? ((await pool.query("SELECT id FROM fleets WHERE name = $1", [body.fleetName])).rows[0]?.id as
            | string
            | undefined)
        : undefined;
    const levelId =
      body.levelName !== undefined
        ? ((await pool.query("SELECT id FROM levels WHERE name = $1", [body.levelName])).rows[0]?.id as
            | string
            | undefined)
        : undefined;

    const { rows } = await pool.query(
      `INSERT INTO robots (serial, name, mac, wifi_ssid, fleet_id, level_id,
                           firmware_version, pi_version, capabilities, battery_spec, last_seen)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       ON CONFLICT (serial) DO UPDATE SET
         name             = COALESCE(EXCLUDED.name, robots.name),
         mac              = COALESCE(EXCLUDED.mac, robots.mac),
         wifi_ssid        = COALESCE(EXCLUDED.wifi_ssid, robots.wifi_ssid),
         fleet_id         = COALESCE(EXCLUDED.fleet_id, robots.fleet_id),
         level_id         = COALESCE(EXCLUDED.level_id, robots.level_id),
         firmware_version = COALESCE(EXCLUDED.firmware_version, robots.firmware_version),
         pi_version       = COALESCE(EXCLUDED.pi_version, robots.pi_version),
         capabilities     = COALESCE(EXCLUDED.capabilities, robots.capabilities),
         battery_spec     = COALESCE(EXCLUDED.battery_spec, robots.battery_spec),
         last_seen        = now()
       RETURNING *`,
      [
        body.serial,
        body.name ?? null,
        body.mac ?? null,
        body.wifiSsid ?? null,
        fleetId ?? null,
        levelId ?? null,
        body.firmwareVersion ?? null,
        body.piVersion ?? null,
        body.capabilities !== undefined ? JSON.stringify(body.capabilities) : JSON.stringify([]),
        body.batterySpec !== undefined ? JSON.stringify(body.batterySpec) : JSON.stringify({}),
      ],
    );

    // unprovisioned -> active once both fleet and level are assigned.
    const { rows: finalRows } = await pool.query(
      `UPDATE robots SET status = 'active'
       WHERE serial = $1 AND status = 'unprovisioned' AND fleet_id IS NOT NULL AND level_id IS NOT NULL
       RETURNING *`,
      [body.serial],
    );
    const robot = mapRobot((finalRows[0] ?? rows[0]) as Record<string, unknown>);

    await writeAudit("provisioning", "robot.register", `/api/v1/robots/register`, { serial: body.serial });
    await publish("registry.changed", { resource: "robot", id: robot.id, action: "registered" });
    res.status(201).json(robot);
  }),
);
