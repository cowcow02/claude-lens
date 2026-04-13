/**
 * Usage-poller daemon worker. Runs detached. Polls /api/oauth/usage every
 * POLL_INTERVAL_MS and appends each snapshot to `~/.cclens/usage.jsonl`.
 * Logs errors to `~/.cclens/daemon.log` but never crashes on transient
 * failures — keeps retrying so a temporary network or token issue doesn't
 * require manual intervention.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fetchUsage, UsageApiError } from "./usage/api.js";
import { appendSnapshot } from "./usage/storage.js";

const STATE_DIR = join(homedir(), ".cclens");
const USAGE_LOG = join(STATE_DIR, "usage.jsonl");
const DAEMON_LOG = join(STATE_DIR, "daemon.log");
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

mkdirSync(dirname(USAGE_LOG), { recursive: true });

function log(level: "info" | "warn" | "error", message: string): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}\n`;
  try {
    appendFileSync(DAEMON_LOG, line, "utf8");
  } catch {
    // Nothing to do — the disk might be full. Swallow and keep running.
  }
}

async function tick(): Promise<void> {
  try {
    const snapshot = await fetchUsage();
    appendSnapshot(USAGE_LOG, snapshot);
    log(
      "info",
      `snapshot 5h=${snapshot.five_hour.utilization}% 7d=${snapshot.seven_day.utilization}%`,
    );
  } catch (err) {
    if (err instanceof UsageApiError) {
      log("warn", `poll failed (${err.code}): ${err.message}`);
    } else {
      log("error", `unexpected error: ${(err as Error).stack ?? err}`);
    }
  }
}

log("info", `daemon started (pid=${process.pid}, interval=${POLL_INTERVAL_MS / 1000}s)`);

// First poll immediately so the user sees data right away.
void tick();
setInterval(() => {
  void tick();
}, POLL_INTERVAL_MS);

process.on("SIGTERM", () => {
  log("info", `daemon stopping (pid=${process.pid})`);
  process.exit(0);
});
