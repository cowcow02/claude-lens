import { getServerStatus, startServer, openBrowser } from "../server.js";
import { checkForUpdate } from "../updater.js";

export async function start(args: string[]): Promise<void> {
  const portFlag = args.indexOf("--port");
  const port = portFlag !== -1 ? parseInt(args[portFlag + 1], 10) : undefined;

  // Auto-update check
  try {
    await checkForUpdate();
  } catch {
    // Silently skip if updater fails
  }

  // Check if already running
  const status = getServerStatus();
  if (status.running) {
    console.log(`Claude Lens is already running on http://localhost:${status.port} (PID ${status.pid})`);
    openBrowser(`http://localhost:${status.port}`);
    return;
  }

  console.log("Starting Claude Lens...");

  try {
    const result = await startServer({ port });
    console.log(`Claude Lens running on http://localhost:${result.port} (PID ${result.pid})`);
    openBrowser(`http://localhost:${result.port}`);
  } catch (err) {
    console.error(`Failed to start: ${(err as Error).message}`);
    process.exit(1);
  }
}
