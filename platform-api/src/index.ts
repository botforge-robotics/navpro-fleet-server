import express from "express";
import http from "http";
import { config } from "./config";
import { logger, errorFields } from "./logger";
import { runMigrations } from "./db/migrate";
import { closePool } from "./db/pool";
import { closeRedis } from "./redis";
import { errorHandler } from "./http/errors";
import { authRouter } from "./auth/routes";
import { seedAdminUser } from "./auth/seed";
import { seedSiteDefaults } from "./auth/seed-site";
import { registryRouter } from "./registry/routes";
import { configGenRouter } from "./config-gen/routes";
import { generateSiteSafe } from "./config-gen/generate";
import { workflowsRouter, missionsRouter } from "./workflows/routes";
import { resumeInFlightMissions } from "./workflows/saga";
import { heartbeatRouter, healthQueryRouter } from "./health/routes";
import { startOfflineMonitor } from "./health/monitor";
import { attachHealthWebsocket, WS_PATH } from "./health/ws";
import { deviceOpsRouter } from "./devices/routes";
import { analyticsRouter } from "./analytics/routes";
import { rmfProxyRouter, attachRmfProxyUpgrade, RMF_PROXY_PATH } from "./rmf-proxy";
import { guiRouter } from "./gui/routes";
import { siteRouter } from "./site/routes";
import { startBuiltinConsumers } from "./events/consumers";
import { startConsumer, type Consumer } from "./events/consumer";

function buildApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");

  // The RMF-compatible proxy must be mounted before the JSON body parser so
  // request bodies stream through to the api-server untouched.
  app.use(RMF_PROXY_PATH, rmfProxyRouter());

  // Occupancy maps (pgm base64) can be large.
  app.use(express.json({ limit: "64mb" }));

  app.get("/api/v1/health", (_req, res) => {
    res.json({ status: "ok", service: "platform-api" });
  });

  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1", configGenRouter);
  app.use("/api/v1/workflows", workflowsRouter);
  app.use("/api/v1/missions", missionsRouter);
  app.use("/api/v1", heartbeatRouter); // provisioning-token or JWT auth inside
  app.use("/api/v1", healthQueryRouter); // GUI HealthSample[] reads (auth per-route)
  // GUI compat + enriched read overrides; mounted before the raw registry CRUD
  // so GET /robots, /levels, /fleets serve the GUI shapes.
  app.use("/api/v1", guiRouter());
  app.use("/api/v1", siteRouter); // occupancy upload, import-building, graph editor
  app.use("/api/v1/devices", deviceOpsRouter); // GUI list + /:id/status|command|health
  app.use("/api/v1/analytics", analyticsRouter);
  app.use("/api/v1", registryRouter()); // robots, fleets, levels, buildings, devices CRUD

  app.use((_req, res) => res.status(404).json({ error: "not found" }));
  app.use(errorHandler);
  return app;
}

async function main(): Promise<void> {
  await runMigrations();
  await seedAdminUser();
  await seedSiteDefaults();

  const app = buildApp();
  const server = http.createServer(app);

  const healthWs = attachHealthWebsocket(server);
  attachRmfProxyUpgrade(server);
  // Reject upgrades no handler claims so sockets never hang.
  server.on("upgrade", (req, socket) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname !== WS_PATH && !pathname.startsWith(RMF_PROXY_PATH)) socket.destroy();
  });

  const consumers: Consumer[] = startBuiltinConsumers();
  // Config generation reacts to registry changes through the event bus.
  consumers.push(
    startConsumer("platform-config-gen", async (event) => {
      if (event.type === "registry.changed") generateSiteSafe();
    }),
  );

  const offlineMonitor = startOfflineMonitor();
  await resumeInFlightMissions();

  server.listen(config.port, () => {
    logger.info("platform-api listening", { port: config.port });
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutting down", { signal });
    offlineMonitor.stop();
    healthWs.stop();
    server.close(() => {
      void Promise.allSettled(consumers.map((c) => c.stop()))
        .then(() => closeRedis())
        .then(() => closePool())
        .finally(() => process.exit(0));
    });
    // Hard exit if graceful shutdown stalls.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error("fatal startup error", errorFields(err));
  process.exit(1);
});
