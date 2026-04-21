import { getPool } from "./pool";
import { SCHEMA_SQL } from "./schema";

export async function runMigrations(): Promise<void> {
  await getPool().query(SCHEMA_SQL);
}
