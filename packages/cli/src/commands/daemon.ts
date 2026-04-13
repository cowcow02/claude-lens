import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, statSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { writePid, readPid, isProcessAlive, cleanStalePid, removePid } from "../pid.js";
import { latestSnapshot } from "../usage/storage.js";

const STATE_DIR = join(homedir(), ".cclens");
const DAEMON_PID = join(STATE_DIR, "daemon.pid");
const USAGE_LOG = join(STATE_DIR, "usage.jsonl");
const DAEMON_LOG = join(STATE_DIR, "daemon.log");

function workerPath(): string {
  // Both the CLI entrypoint and the daemon worker are bundled into dist/.
  // The build step emits two files: dist/index.js and dist/daemon-worker.js.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "daemon-worker.js");
}

export async function daemon(args: string[]): Promise<void> {
  const sub = args[0] ?? "status";

  switch (sub) {
    case "start":
      await daemonStart();
      break;
    case "stop":
      daemonStop();
      break;
    case "status":
      daemonStatus();
      break;
    case "logs":
      daemonLogs();
      break;
    default:
      console.error(`Unknown daemon subcommand: ${sub}`);
      console.error("Usage: fleetlens daemon <start|stop|status|logs>");
      process.exit(1);
  }
}

async function daemonStart(): Promise<void> {
  cleanStalePid(DAEMON_PID);
  const existing = readPid(DAEMON_PID);
  if (existing !== null && isProcessAlive(existing.pid)) {
    console.log(`Daemon is already running (PID ${existing.pid})`);
    return;
  }

  const script = workerPath();
  if (!existsSync(script)) {
    console.error(`Daemon worker not found at ${script}. Rebuild with: pnpm -F fleetlens build`);
    process.exit(1);
  }

  const child = spawn(process.execPath, [script], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  const pid = child.pid!;
  writePid(DAEMON_PID, pid);

  console.log(`Daemon started (PID ${pid})`);
  console.log(`Polling every 5 minutes. Logs: ${DAEMON_LOG}`);
}

function daemonStop(): void {
  cleanStalePid(DAEMON_PID);
  const entry = readPid(DAEMON_PID);
  if (entry === null) {
    console.log("Daemon is not running.");
    return;
  }

  try {
    process.kill(entry.pid, "SIGTERM");
  } catch {
    // Already gone
  }
  removePid(DAEMON_PID);
  console.log(`Stopped daemon (PID ${entry.pid})`);
}

function daemonStatus(): void {
  cleanStalePid(DAEMON_PID);
  const entry = readPid(DAEMON_PID);
  const running = entry !== null && isProcessAlive(entry.pid);

  if (running) {
    console.log(`Daemon: running (PID ${entry!.pid})`);
  } else {
    console.log("Daemon: not running");
  }

  // Last snapshot info, regardless of daemon state
  const latest = latestSnapshot(USAGE_LOG);
  if (latest) {
    const age = Math.round((Date.now() - new Date(latest.captured_at).getTime()) / 1000);
    const ageStr = age < 60 ? `${age}s` : age < 3600 ? `${Math.round(age / 60)}m` : `${Math.round(age / 3600)}h`;
    console.log(`Last snapshot: ${ageStr} ago`);
    console.log(`  5h:    ${latest.five_hour.utilization?.toFixed(1) ?? "—"}%`);
    console.log(`  7d:    ${latest.seven_day.utilization?.toFixed(1) ?? "—"}%`);
  } else {
    console.log("Last snapshot: none yet");
  }

  if (existsSync(USAGE_LOG)) {
    const size = statSync(USAGE_LOG).size;
    console.log(`Usage log: ${USAGE_LOG} (${size} bytes)`);
  }
}

function daemonLogs(): void {
  if (!existsSync(DAEMON_LOG)) {
    console.log("No daemon logs yet.");
    return;
  }
  const content = readFileSync(DAEMON_LOG, "utf8");
  const lines = content.trim().split("\n").slice(-20);
  for (const line of lines) process.stdout.write(line + "\n");
}
