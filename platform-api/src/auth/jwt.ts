import { readFileSync } from "fs";
import jwt from "jsonwebtoken";
import { config } from "../config";
import type { Role } from "../models";

export interface AuthContext {
  userId: string;
  username: string;
  roles: Role[];
}

let privateKey: string | undefined;
let publicKey: string | undefined;

function getPrivateKey(): string {
  if (privateKey === undefined) privateKey = readFileSync(config.jwtPrivateKeyPath, "utf8");
  return privateKey;
}

function getPublicKey(): string {
  if (publicKey === undefined) publicKey = readFileSync(config.jwtPublicKeyPath, "utf8");
  return publicKey;
}

const TOKEN_TTL_SECONDS = 12 * 60 * 60;

export function signToken(userId: string, username: string, roles: Role[]): string {
  return jwt.sign(
    { preferred_username: username, roles },
    getPrivateKey(),
    {
      algorithm: "RS256",
      subject: userId,
      audience: config.jwtAudience,
      issuer: config.jwtIssuer,
      expiresIn: TOKEN_TTL_SECONDS,
    },
  );
}

const VALID_ROLES: readonly string[] = ["operator", "supervisor", "admin", "support"];

export function verifyToken(token: string): AuthContext {
  const decoded = jwt.verify(token, getPublicKey(), {
    algorithms: ["RS256"],
    audience: config.jwtAudience,
    issuer: config.jwtIssuer,
  });
  if (typeof decoded === "string") throw new Error("unexpected string JWT payload");

  const username = typeof decoded.preferred_username === "string" ? decoded.preferred_username : "";
  const rawRoles = Array.isArray(decoded.roles) ? decoded.roles : [];
  const roles = rawRoles.filter((r): r is Role => typeof r === "string" && VALID_ROLES.includes(r));
  return { userId: decoded.sub ?? "", username, roles };
}
