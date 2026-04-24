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

  // Drizzle's migrator (0.40.x) picks the LATEST __drizzle_migrations row
  // (ORDER BY created_at DESC LIMIT 1) and only applies a migration when its
  // folderMillis > that row's created_at. To mark "0000 already applied but
  // 0001+ still need to run" we must insert 0000's folderMillis — not
  // Date.now(), which would mask every future migration. Hash is sha256 of the
  // raw SQL for audit consistency; the migrator doesn't read it.
  const sqlPath = join(__dirname, "migrations", "0000_initial.sql");
  const sql = readFileSync(sqlPath, "utf8");
  const hash = createHash("sha256").update(sql).digest("hex");

  const journal = JSON.parse(
    readFileSync(join(__dirname, "migrations", "meta", "_journal.json"), "utf8"),
  ) as { entries: Array<{ idx: number; when: number }> };
  const firstEntry = journal.entries.find((e) => e.idx === 0);
  if (!firstEntry) throw new Error("baseline: 0000 entry missing from _journal.json");

  await client.query(
    `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
    [hash, firstEntry.when],
  );
}
