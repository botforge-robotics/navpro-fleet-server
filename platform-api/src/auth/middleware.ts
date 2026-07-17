import type { NextFunction, Request, RequestHandler, Response } from "express";
import { HttpError } from "../http/errors";
import type { Role } from "../models";
import { pool } from "../db/pool";
import { logger, errorFields } from "../logger";
import { verifyToken, type AuthContext } from "./jwt";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/** Role hierarchy: higher rank implies all lower-rank permissions. Support is read-only. */
const ROLE_RANK: Record<Role, number> = {
  support: 0,
  operator: 1,
  supervisor: 2,
  admin: 3,
};

function extractBearer(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header === undefined || !header.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length);
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearer(req);
  if (token === undefined) {
    next(new HttpError(401, "missing bearer token"));
    return;
  }
  try {
    req.auth = verifyToken(token);
    next();
  } catch {
    next(new HttpError(401, "invalid or expired token"));
  }
}

/**
 * Allows a request when the user's highest role meets or exceeds the lowest
 * rank among the listed roles (admin > supervisor > operator > support).
 */
export function requireRole(...roles: Role[]): RequestHandler {
  const requiredRank = Math.min(...roles.map((r) => ROLE_RANK[r]));
  return (req, _res, next) => {
    const auth = req.auth;
    if (auth === undefined) {
      next(new HttpError(401, "not authenticated"));
      return;
    }
    const rank = Math.max(-1, ...auth.roles.map((r) => ROLE_RANK[r]));
    if (rank < requiredRank) {
      next(new HttpError(403, "insufficient role"));
      return;
    }
    next();
  };
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function writeAudit(
  username: string,
  action: string,
  resource: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    await pool.query(
      "INSERT INTO audit_log (username, action, resource, detail) VALUES ($1, $2, $3, $4)",
      [username, action, resource, JSON.stringify(detail)],
    );
  } catch (err) {
    logger.error("audit write failed", { action, resource, ...errorFields(err) });
  }
}

/**
 * Writes an audit_log row for every mutating request that completes.
 * Mount after requireAuth so req.auth is populated.
 */
export function auditMutations(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }
  res.on("finish", () => {
    const username = req.auth?.username ?? "anonymous";
    void writeAudit(username, req.method, req.originalUrl, {
      status: res.statusCode,
      body: req.body as unknown,
    });
  });
  next();
}
