import { getPool } from "./pool";
import { SCHEMA_SQL } from "./schema";
import { generateBootstrapToken } from "../lib/auth";
import { getBootstrapState, setBootstrapState } from "../lib/bootstrap-state";

export async function runMigrations(): Promise<void> {
  await getPool().query(SCHEMA_SQL);

  const teams = await getPool().query("SELECT 1 FROM teams LIMIT 1");
  if (teams.rowCount) return;

  const existing = await getBootstrapState();
  if (existing && existing.expiresAt > new Date()) return;

  const { token, hash, expiresAt } = generateBootstrapToken();
  await setBootstrapState(hash, expiresAt);
  console.log(`fleetlens-server: bootstrap token = ${token} (valid for 15 minutes)`);
  console.log(`fleetlens-server: to claim this instance, open the server URL and paste the token`);
}
