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

const transformSchema = z.object({
  translation: z.tuple([z.number(), z.number()]),
  rotation: z.number(),
  scale: z.number().positive(),
});

const robotEntrySchema = z.object({
  navigation_stack: z.literal(2),
  initial_map: z.string().min(1),
  charger: z.string().optional(),
});

export const fleetConfigSchema = z.object({
  rmf_fleet: z.object({
    name: z.string().min(1),
    limits: limitsSchema,
    profile: profileSchema,
    battery_system: batterySystemSchema,
    recharge_threshold: z.number().min(0).max(1),
    recharge_soc: z.number().min(0).max(1),
    task_capabilities: z.object({
      loop: z.boolean(),
      delivery: z.boolean(),
      clean: z.boolean(),
    }),
    transforms: z.record(z.string(), transformSchema),
    robots: z.record(z.string(), robotEntrySchema),
  }),
  plugins: z.record(z.string(), z.unknown()).optional(),
});

export type FleetConfig = z.infer<typeof fleetConfigSchema>;
