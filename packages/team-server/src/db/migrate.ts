import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPool } from "./pool.js";

export async function runMigrations(): Promise<void> {
  const sql = readFileSync(join(import.meta.dirname, "schema.sql"), "utf8");
  await getPool().query(sql);
}
