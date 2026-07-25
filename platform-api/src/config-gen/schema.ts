import { z } from "zod";

// Zod schema for the free_fleet_adapter EasyFullControl fleet config we
// generate. Validated before anything is written to SITE_DIR.

const limitsSchema = z.object({
  linear: z.tuple([z.number().positive(), z.number().positive()]),
  angular: z.tuple([z.number().positive(), z.number().positive()]),
});

const profileSchema = z.object({
  footprint: z.number().positive(),
  vicinity: z.number().positive(),
});

const batterySystemSchema = z.object({
  voltage: z.number().positive(),
  capacity: z.number().positive(),
  charging_current: z.number().positive(),
});

const mechanicalSystemSchema = z.object({
  mass: z.number().positive(),
  moment_of_inertia: z.number().positive(),
  friction_coefficient: z.number().positive(),
});

const ambientSystemSchema = z.object({
  power: z.number().nonnegative(),
});

const toolSystemSchema = z.object({
  power: z.number().nonnegative(),
});

const transformSchema = z.object({
  translation: z.tuple([z.number(), z.number()]),
  rotation: z.number(),
  scale: z.number().positive(),
});

const robotEntrySchema = z.object({
  navigation_stack: z.literal(2).optional(),
  initial_map: z.string().min(1),
  charger: z.string().optional(),
  responsive_wait: z.boolean().optional(),
  robot_frame: z.string().min(1).optional(),
  map_frame: z.string().min(1).optional(),
  init_timeout_sec: z.number().positive().optional(),
});

export const fleetConfigSchema = z.object({
  rmf_fleet: z.object({
    name: z.string().min(1),
    limits: limitsSchema,
    profile: profileSchema,
    reversible: z.boolean().optional(),
    battery_system: batterySystemSchema,
    mechanical_system: mechanicalSystemSchema,
    ambient_system: ambientSystemSchema,
    tool_system: toolSystemSchema,
    recharge_threshold: z.number().min(0).max(1),
    recharge_soc: z.number().min(0).max(1),
    publish_fleet_state: z.number().positive().optional(),
    account_for_battery_drain: z.boolean().optional(),
    finishing_request: z.string().optional(),
    task_capabilities: z.object({
      loop: z.boolean(),
      delivery: z.boolean(),
      clean: z.boolean(),
      patrol: z.boolean().optional(),
    }),
    transforms: z.record(z.string(), transformSchema).optional(),
    robots: z.record(z.string(), robotEntrySchema),
  }),
  plugins: z.record(z.string(), z.unknown()).optional(),
  // Identity (or nudged) RMF↔robot frame alignment. Required by EasyFullControl
  // even when Nav2 and the building map share meters — empty → add_robot fails.
  reference_coordinates: z
    .record(
      z.string(),
      z.object({
        rmf: z.array(z.tuple([z.number(), z.number()])).min(2),
        robot: z.array(z.tuple([z.number(), z.number()])).min(2),
      }),
    )
    .optional(),
});

export type FleetConfig = z.infer<typeof fleetConfigSchema>;
