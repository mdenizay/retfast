import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { pool } from "./pool.js";

const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), "migrations");

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const appliedResult = await client.query<{ name: string }>(
      "SELECT name FROM schema_migrations",
    );
    const applied = new Set(appliedResult.rows.map((row) => row.name));
    const files = (await readdir(migrationDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();

    for (const name of files) {
      if (applied.has(name)) continue;
      const sql = await readFile(join(migrationDirectory, name), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (name) VALUES ($1)",
          [name],
        );
        await client.query("COMMIT");
        console.log(`Applied migration ${name}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

await migrate();
