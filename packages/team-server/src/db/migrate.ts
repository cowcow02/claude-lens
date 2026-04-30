import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPreDrizzleBaselineIfNeeded } from "./baseline";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Any 64-bit integer that's unique within this database works. MUST stay
// constant across releases — concurrent boots of different versions still
// serialize on this one key.
const MIGRATION_LOCK_ID = 7326544091n;

export async function runMigrations(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  // Dedicated one-shot client, NOT the shared app pool. pg_advisory_lock
  // (session-scoped) is held only on its acquiring connection, so drizzle's
  // migrator must run every statement on this same client. Using a pool
  // would check out a different connection for DDL and race.
  const client = new Client({ connectionString });
  await client.connect();
  try {
    // Lock id passed as string to avoid node-pg's JS-number coercion
    // truncating values above 2^31. Arrives as bigint in Postgres either way.
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID.toString()]);

    await applyPreDrizzleBaselineIfNeeded(client);

    const db = drizzle(client);
    await migrate(db, { migrationsFolder: join(__dirname, "migrations") });
  } finally {
    // Best-effort unlock; the lock is also released automatically on disconnect.
    await client
      .query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID.toString()])
      .catch(() => {});
    await client.end();
  }
}
