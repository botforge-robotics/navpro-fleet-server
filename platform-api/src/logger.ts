type Level = "debug" | "info" | "warn" | "error";

function log(level: Level, msg: string, fields?: Record<string, unknown>): void {
  const entry = { ts: new Date().toISOString(), level, msg, ...fields };
  const line = JSON.stringify(entry);
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => log("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => log("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => log("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => log("error", msg, fields),
};

export function errorFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { error: err.message, stack: err.stack };
  return { error: String(err) };
}
