import { runMigrations } from "./src/db/migrate";
import { startScheduler } from "./src/lib/scheduler";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  await runMigrations();
  startScheduler();
}
