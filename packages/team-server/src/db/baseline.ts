import { Client } from "pg";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function applyPreDrizzleBaselineIfNeeded(client: Client): Promise<void> {
  // Is this a fresh DB? If user_accounts doesn't exist, nothing to baseline —
  // let the normal migrator run everything from 0000.
  const existing = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'user_accounts'`,
  );
  if (existing.rowCount === 0) return;

  // Pre-create drizzle's journal schema + table so we can insert the baseline
  // row before the migrator itself runs. Table shape matches what drizzle's
  // migrator would create on first run, so post-baseline the migrator treats
  // it as its own bookkeeping table.
  await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at BIGINT
    )
  `);

  const existingJournal = await client.query(
    `SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`,
  );
  if (existingJournal.rows[0].n > 0) return; // already baselined

  // Drizzle's migrator (0.40.x) decides whether to skip a migration by
  // comparing drizzle.__drizzle_migrations.created_at against each migration's
  // folderMillis from meta/_journal.json. The hash column is populated but not
  // consulted by the skip logic — we fill it with sha256 of the raw SQL for
  // audit consistency, not correctness. What makes the skip work is
  // Date.now() > folderMillis, which is trivially true at customer boot time.
  const sqlPath = join(__dirname, "migrations", "0000_initial.sql");
  const sql = readFileSync(sqlPath, "utf8");
  const hash = createHash("sha256").update(sql).digest("hex");

  await client.query(
    `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
    [hash, Date.now()],
  );
}
