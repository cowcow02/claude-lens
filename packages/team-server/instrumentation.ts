export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runMigrations } = await import("./src/db/migrate.js");
    const { startScheduler } = await import("./src/lib/scheduler.js");
    await runMigrations();
    startScheduler();
  }
}
