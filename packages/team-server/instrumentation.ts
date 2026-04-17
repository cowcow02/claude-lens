export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { runMigrations } = await import("./src/db/migrate");
  const { startScheduler } = await import("./src/lib/scheduler");
  await runMigrations();
  startScheduler();
}
