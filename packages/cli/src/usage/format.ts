import type { UsageSnapshot, UsageWindow } from "./api.js";

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

/**
 * Render a compact usage snapshot table suitable for a terminal.
 * Matches the feel of Claude Code's `/usage` output but with more detail.
 */
export function formatUsage(snapshot: UsageSnapshot): string {
  const rows: [label: string, window: UsageWindow | null][] = [
    ["5 hour", snapshot.five_hour],
    ["7 day", snapshot.seven_day],
    ["7 day (Opus)", snapshot.seven_day_opus],
    ["7 day (Sonnet)", snapshot.seven_day_sonnet],
    ["7 day (OAuth apps)", snapshot.seven_day_oauth_apps],
    ["7 day (Cowork)", snapshot.seven_day_cowork],
  ];

  const lines: string[] = [];
  lines.push("");
  lines.push(`${BOLD}Claude Code Usage${RESET}`);
  lines.push("");
  lines.push(`${DIM}Window              Utilization               Resets${RESET}`);
  lines.push(`${DIM}${"─".repeat(72)}${RESET}`);

  for (const [label, window] of rows) {
    if (!window || window.utilization === null) continue;
    const bar = renderBar(window.utilization, 20);
    const pct = `${window.utilization.toFixed(1)}%`.padStart(6);
    const resets = window.resets_at ? formatRelative(window.resets_at) : "—";
    lines.push(`${label.padEnd(20)}${bar} ${pct}   ${DIM}${resets}${RESET}`);
  }

  if (snapshot.extra_usage?.is_enabled) {
    const extra = snapshot.extra_usage;
    lines.push("");
    lines.push(`${BOLD}Extra usage${RESET}`);
    if (extra.utilization !== null) {
      lines.push(`  utilization: ${extra.utilization.toFixed(1)}%`);
    }
    if (extra.used_credits !== null && extra.monthly_limit !== null) {
      lines.push(`  credits: ${extra.used_credits} / ${extra.monthly_limit}`);
    }
  }

  lines.push("");
  lines.push(`${DIM}Captured ${formatRelative(snapshot.captured_at)}${RESET}`);
  lines.push("");
  return lines.join("\n");
}

function renderBar(utilization: number, width: number): string {
  const clamped = Math.max(0, Math.min(100, utilization));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const color = clamped >= 90 ? RED : clamped >= 70 ? YELLOW : GREEN;
  return `${color}${"█".repeat(filled)}${RESET}${DIM}${"░".repeat(empty)}${RESET}`;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((then - now) / 1000);
  const abs = Math.abs(diffSec);

  if (abs < 60) return diffSec < 0 ? `${abs}s ago` : `in ${abs}s`;
  if (abs < 3600) return diffSec < 0 ? `${Math.round(abs / 60)}m ago` : `in ${Math.round(abs / 60)}m`;
  if (abs < 86400) return diffSec < 0 ? `${Math.round(abs / 3600)}h ago` : `in ${Math.round(abs / 3600)}h`;
  return diffSec < 0
    ? `${Math.round(abs / 86400)}d ago`
    : `in ${Math.round(abs / 86400)}d`;
}
