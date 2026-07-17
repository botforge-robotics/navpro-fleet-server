/**
 * RMF-COMPATIBLE PASS-THROUGH LAYER (declared exception).
 *
 * This module is the reverse proxy that makes the Platform API look like the
 * RMF api-server to the dashboard's generated client. It is, by design, the
 * RMF-aware edge of the platform (together with src/workflows/rmf-tasks.ts);
 * everything platform-native must stay RMF-free.
 */
import type { Server } from "http";
import { Router } from "express";
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { createProxyMiddleware } from "http-proxy-middleware";
import { config } from "../config";
import { requireAuth, auditMutations } from "../auth/middleware";
import { verifyToken } from "../auth/jwt";
import { logger } from "../logger";

export const RMF_PROXY_PATH = "/rmf";

const proxy = createProxyMiddleware({
  target: config.rmfApiServerUrl,
  changeOrigin: true,
  ws: false, // websocket upgrades are handled explicitly in attachRmfProxyUpgrade
  pathRewrite: { [`^${RMF_PROXY_PATH}`]: "" },
  logLevel: "warn",
  // Authorization header is forwarded unchanged by default; the api-server
  // validates the same RS256 JWT (shared public key, aud=rmf_api_server).
});

export function rmfProxyRouter(): Router {
  const router = Router();
  // Floorplan PNGs are loaded by <img src> without Authorization. Upstream
  // api-server serves /cache as static files with no auth; keep the same here.
  router.use("/cache", proxy);
  // socket.io Engine.IO HTTP polling also has no Bearer header. The api-server
  // authenticates on the socket.io CONNECT packet (auth.token) instead. Without
  // this exemption, Map robots + Doors table never get live state.
  router.use("/socket.io", proxy);
  router.use(requireAuth, auditMutations, proxy);
  return router;
}

/**
 * Proxies websocket upgrades under /rmf to the api-server.
 *
 * - /rmf/socket.io: auth is done by api-server on the CONNECT packet (no
 *   Authorization header on the browser upgrade request).
 * - other /rmf websockets (e.g. trajectory): require Bearer or ?token=.
 */
export function attachRmfProxyUpgrade(server: Server): void {
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith(RMF_PROXY_PATH)) return;

    const isSocketIo = url.pathname.startsWith(`${RMF_PROXY_PATH}/socket.io`);
    if (!isSocketIo) {
      const headerToken = req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice("Bearer ".length)
        : undefined;
      const token = url.searchParams.get("token") ?? headerToken;
      if (token === undefined || token === null) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      try {
        verifyToken(token);
      } catch {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    logger.debug("proxying websocket upgrade", { path: url.pathname });
    // http-proxy-middleware exposes the underlying http-proxy upgrade handler.
    // Its type signature expects an express Request, but at runtime it only
    // needs the raw IncomingMessage, which is what upgrade events provide.
    proxy.upgrade?.(req as never, socket as never, head);
  });
}
