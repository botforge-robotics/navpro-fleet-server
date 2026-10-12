import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { logger, errorFields } from "../logger";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
  }
}

export function notFound(resource: string): HttpError {
  return new HttpError(404, `${resource} not found`);
}

export function badRequest(message: string, detail?: unknown): HttpError {
  return new HttpError(400, message, detail);
}

/** Wraps an async route handler so rejections reach the central error handler. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, detail: err.detail });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: "validation failed", detail: err.issues });
    return;
  }
  logger.error("unhandled error", { path: req.path, ...errorFields(err) });
  res.status(500).json({ error: "internal server error" });
}
