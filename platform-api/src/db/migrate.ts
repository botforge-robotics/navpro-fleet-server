import { promises as fs } from "fs";
import path from "path";
import { pool } from "./pool";
import { logger } from "../logger";

/**
 * Ordered .sql migration runner. Files in src/db/migrations/ are copied
 * next to the compiled output (dist/db/migrations/) by the build step,
 * so __dirname-relative resolution works both in ts-node and in dist.
 */
export async function runMigrations(): Promise<void> {
  const migrationsDir = path.join(__dirname, "migrations");
  const entries = await fs.readdir(migrationsDir);
  const files = entries.filter((f) => f.endsWith(".sql")).sort();

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const file of files) {
      const { rowCount } = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
      if (rowCount && rowCount > 0) continue;

      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      logger.info("applying migration", { file });
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    client.release();
  }
}
