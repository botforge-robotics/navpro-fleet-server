function env(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== "") return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable: ${name}`);
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) throw new Error(`Environment variable ${name} must be an integer, got "${raw}"`);
  return parsed;
}

export interface Config {
  port: number;
  databaseUrl: string;
  redisCacheUrl: string;
  redisStreamsUrl: string;
  rmfApiServerUrl: string;
  siteDir: string;
  jwtPrivateKeyPath: string;
  jwtPublicKeyPath: string;
  jwtIssuer: string;
  jwtAudience: string;
  adminUsername: string;
  adminPassword: string;
  provisioningToken: string;
}

export const config: Config = {
  port: envInt("PORT", 8080),
  databaseUrl: env("DATABASE_URL"),
  redisCacheUrl: env("REDIS_CACHE_URL"),
  redisStreamsUrl: env("REDIS_STREAMS_URL"),
  rmfApiServerUrl: env("RMF_API_SERVER_URL", "http://rmf-api-server:8000"),
  siteDir: env("SITE_DIR", "/site"),
  jwtPrivateKeyPath: env("JWT_PRIVATE_KEY_PATH", "/keys/jwt-private.pem"),
  jwtPublicKeyPath: env("JWT_PUBLIC_KEY_PATH", "/keys/jwt-public.pem"),
  jwtIssuer: env("JWT_ISS", "navpro-platform"),
  jwtAudience: env("JWT_AUD", "rmf_api_server"),
  adminUsername: env("ADMIN_USERNAME"),
  adminPassword: env("ADMIN_PASSWORD"),
  provisioningToken: env("PROVISIONING_TOKEN"),
};
