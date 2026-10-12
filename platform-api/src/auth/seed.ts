import bcrypt from "bcryptjs";
import { config } from "../config";
import { pool } from "../db/pool";
import { logger } from "../logger";

/** Creates the admin user from ADMIN_USERNAME/ADMIN_PASSWORD if it does not exist. */
export async function seedAdminUser(): Promise<void> {
  const { rowCount } = await pool.query("SELECT 1 FROM users WHERE username = $1", [config.adminUsername]);
  if (rowCount && rowCount > 0) return;

  const hash = await bcrypt.hash(config.adminPassword, 10);
  await pool.query(
    "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin') ON CONFLICT (username) DO NOTHING",
    [config.adminUsername, hash],
  );
  logger.info("seeded admin user", { username: config.adminUsername });
}
