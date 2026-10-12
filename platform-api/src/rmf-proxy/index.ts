/**
 * RMF-COMPATIBLE PASS-THROUGH LAYER (declared exception).
 *
 * This module is the reverse proxy that makes the Platform API look like the
 * RMF api-server to the dashboard's generated client. It is, by design, the
 * RMF-aware edge of the platform (together with src/workflows/rmf-tasks.ts);
 * everything platform-native must stay RMF-free.
 */
import type { Server } from "http";
import http from "http";
import https from "https";
import { Router } from "express";
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import type { Request, Response, NextFunction } from "express";
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
  // Router is mounted at /rmf, so req.url is already without /rmf (e.g. /building_map).
  pathRewrite: { [`^${RMF_PROXY_PATH}`]: "" },
  logLevel: "warn",
  // Authorization header is forwarded unchanged by default; the api-server
  // validates the same RS256 JWT (shared public key, aud=rmf_api_server).
  selfHandleResponse: true,
  onProxyRes: (proxyRes, req, res) => {
    const chunks: Buffer[] = [];
    proxyRes.on("data", (c: Buffer) => chunks.push(c));
    proxyRes.on("end", () => {
      const raw = Buffer.concat(chunks);
      // Make floorplan URLs host-relative so Maps works via localhost or LAN IP
      // (api-server embeds absolute RMF_API_SERVER_PUBLIC_URL which goes stale).
      const ct = String(proxyRes.headers["content-type"] ?? "");
      const pathOnly = (req.url ?? "").split("?")[0] ?? "";
      const isBuildingMap =
        pathOnly === "/building_map" || pathOnly.endsWith("/building_map");
      let body: Buffer = raw;
      if (isBuildingMap && ct.includes("application/json") && raw.length > 0) {
        try {
          const text = raw.toString("utf8");
          const rewritten = text.replace(
            /https?:\/\/[^"'\\]+\/rmf\/cache\//g,
            "/rmf/cache/",
          );
          body = Buffer.from(rewritten, "utf8");
        } catch {
          body = raw;
        }
      }
      const headers = { ...proxyRes.headers };
      delete headers["content-length"];
      headers["content-length"] = String(body.length);
      res.writeHead(proxyRes.statusCode ?? 502, headers);
      res.end(body);
    });
  },
});

/** Pipe /rmf/cache/* → upstream /cache/* (no auth; used by <img src>). */
function cacheStaticProxy(req: Request, res: Response, _next: NextFunction): void {
  const target = new URL(config.rmfApiServerUrl);
  // Express mount strips /cache → req.url is /site/...png
  const upstreamPath = `/cache${req.url}`;
  const lib = target.protocol === "https:" ? https : http;
  const headers: http.OutgoingHttpHeaders = { ...req.headers, host: target.host };
  delete headers["content-length"];
  const upReq = lib.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      path: upstreamPath,
      method: req.method,
      headers,
    },
    (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers);
      upRes.pipe(res);
    },
  );
  upReq.on("error", (err) => {
    logger.warn("rmf cache proxy failed", { path: upstreamPath, err: err.message });
    if (!res.headersSent) {
      res.status(502).json({ error: "cache proxy failed" });
    }
  });
  req.pipe(upReq);
}

export function rmfProxyRouter(): Router {
  const router = Router();
  // Floorplan PNGs are loaded by <img src> without Authorization. Upstream
  // api-server serves /cache as static files with no auth; keep the same here.
  router.use("/cache", cacheStaticProxy);
  // socket.io Engine.IO HTTP polling also has no Bearer header. The api-server
  // authenticates on the socket.io CONNECT packet (auth.token) instead. Without
  // this exemption, Map robots + Doors table never get live state.
  // Nested Express mount strips /socket.io from req.url; restore it for upstream.
  router.use(
    "/socket.io",
    createProxyMiddleware({
      target: config.rmfApiServerUrl,
      changeOrigin: true,
      ws: false,
      pathRewrite: (path) => `/socket.io${path}`,
      logLevel: "warn",
    }),
  );
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
