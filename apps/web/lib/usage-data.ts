/**
 * Server-only reader for the cclens usage metrics JSONL file.
 * The daemon writes to ~/.cclens/usage.jsonl every 5 minutes;
 * the dashboard reads the same file — no API endpoint needed.
 */

import "server-only";
import { cache } from "react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type UsageWindow = {
  utilization: number | null;
  resets_at: string | null;
};

export type UsageSnapshot = {
  captured_at: string;
  five_hour: UsageWindow;
  seven_day: UsageWindow;
  seven_day_opus: UsageWindow | null;
  seven_day_sonnet: UsageWindow | null;
  seven_day_oauth_apps: UsageWindow | null;
  seven_day_cowork: UsageWindow | null;
  extra_usage: {
    is_enabled: boolean;
    monthly_limit: number | null;
    used_credits: number | null;
    utilization: number | null;
  } | null;
};

function usageLogPath(): string {
  return process.env.CCLENS_USAGE_LOG || join(homedir(), ".cclens", "usage.jsonl");
}

export const readUsageSnapshots = cache((): UsageSnapshot[] => {
  const path = usageLogPath();
  if (!existsSync(path)) return [];
  const content = readFileSync(path, "utf8");
  const snapshots: UsageSnapshot[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      snapshots.push(JSON.parse(line) as UsageSnapshot);
    } catch {
      // Skip corrupt lines
    }
  }
  return snapshots;
});

export const latestUsageSnapshot = cache((): UsageSnapshot | null => {
  const all = readUsageSnapshots();
  return all.length > 0 ? all[all.length - 1]! : null;
});
