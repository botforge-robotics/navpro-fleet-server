import { Router } from "express";
import { asyncHandler } from "../http/errors";
import { requireAuth, requireRole, auditMutations } from "../auth/middleware";
import { publish } from "../events/bus";
import { generateSite } from "./generate";

export const configGenRouter = Router();

configGenRouter.post(
  "/site/generate",
  requireAuth,
  requireRole("supervisor"),
  auditMutations,
  asyncHandler(async (_req, res) => {
    const result = await generateSite();
    await publish("site.generated", { fleets: result.fleets });
    res.json(result);
  }),
);
