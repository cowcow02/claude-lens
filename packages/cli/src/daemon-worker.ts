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
// How often the watchdog loop wakes to check if it's time to poll. A
// small interval here means the daemon notices system wake-from-sleep
// within ~30s and can backfill immediately, instead of waiting out the
// remainder of a stale 5-minute setInterval that suspended during sleep.
const WATCHDOG_INTERVAL_MS = 30 * 1000;

mkdirSync(dirname(USAGE_LOG), { recursive: true });

function log(level: "info" | "warn" | "error", message: string): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}\n`;
  try {
    appendFileSync(DAEMON_LOG, line, "utf8");
  } catch {
    // Nothing to do — the disk might be full. Swallow and keep running.
  }
}

let lastPollAtMs = 0;

async function tick(): Promise<void> {
  lastPollAtMs = Date.now();
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wall-clock-driven polling loop.
 *
 * The previous implementation used `setInterval(tick, POLL_INTERVAL_MS)`.
 * That works fine on a machine that never sleeps, but on a laptop the
 * libuv timer is suspended while the system is asleep. On wake, the
 * timer resumes counting — so if we were 4m into the interval when
 * sleep started, we only wait another 1m post-wake, which means every
 * "overnight" the snapshot log falls silent for hours then gets one
 * stale-looking entry.
 *
 * Instead, run a watchdog loop that wakes every 30s and polls whenever
 * wall-clock time shows at least POLL_INTERVAL_MS has elapsed since
 * the last poll. After a long sleep, the first watchdog tick after
 * wake immediately catches up the missed poll. During normal steady
 * state, it still polls every ~5 minutes on the dot.
 */
async function runLoop(): Promise<void> {
  while (true) {
    const now = Date.now();
    const elapsed = now - lastPollAtMs;
    if (elapsed >= POLL_INTERVAL_MS) {
      if (lastPollAtMs > 0 && elapsed > POLL_INTERVAL_MS * 1.5) {
        // Big gap — likely the machine just woke from sleep. Log it so
        // the user can tell a gap in usage.jsonl came from sleep, not a
        // crashed daemon.
        log(
          "info",
          `wake-from-sleep catch-up: ${Math.round(elapsed / 1000)}s since last poll (expected ${POLL_INTERVAL_MS / 1000}s)`,
        );
      }
      await tick();
    }
    await sleep(WATCHDOG_INTERVAL_MS);
  }
}

log(
  "info",
  `daemon started (pid=${process.pid}, interval=${POLL_INTERVAL_MS / 1000}s, watchdog=${WATCHDOG_INTERVAL_MS / 1000}s)`,
);

// Kick the loop. runLoop() never resolves — it runs until SIGTERM.
void runLoop();

process.on("SIGTERM", () => {
  log("info", `daemon stopping (pid=${process.pid})`);
  process.exit(0);
});
