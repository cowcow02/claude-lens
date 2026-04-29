import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * `fleetlens runs` — inspect live LLM call activity + recent token spend.
 *
 * Sources:
 *   - `ps` for currently-running `claude -p ... --append-system-prompt …`
 *     subprocesses. The system-prompt cmdline tells us which kind of digest
 *     each call is for (week / top-session / day / entry-enrich).
 *   - `~/.cclens/llm-spend.jsonl` for completed calls — input/output tokens
 *     and per-call cost.
 *
 * Flags:
 *   --json          machine-readable output
 *   --watch         redraw every 2s until ctrl-c
 *   --since <ISO|N> only count spend records since this timestamp (default 24h)
 */
export async function runs(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const watch = args.includes("--watch");
  const sinceIdx = args.indexOf("--since");
  const sinceArg = sinceIdx >= 0 ? args[sinceIdx + 1] : null;

  const sinceMs = parseSince(sinceArg ?? "24h");

  if (watch) {
    if (json) {
      console.error("--json and --watch are mutually exclusive");
      process.exit(2);
    }
    // Hide cursor + clear-screen redraw loop. Ctrl-C exits.
    process.stdout.write("\x1B[?25l");
    process.on("SIGINT", () => {
      process.stdout.write("\x1B[?25h\n");
      process.exit(0);
    });
    while (true) {
      const snap = collect(sinceMs);
      process.stdout.write("\x1B[2J\x1B[H");  // clear + home
      printText(snap);
      console.log("\n  refreshing every 2s · ^C to quit");
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  const snap = collect(sinceMs);
  if (json) {
    console.log(JSON.stringify(snap, null, 2));
  } else {
    printText(snap);
  }
}

// ── Data shape ───────────────────────────────────────────────────────────

type ActiveRun = {
  pid: number;
  kind: string;
  model: string;
  /** Seconds since this process started. */
  elapsed_s: number;
  /** Total CPU time used (mostly tracks output-streaming progress). */
  cpu_time: string;
};

type CompletedRun = {
  ts: string;
  kind: string;
  ref: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
};

type Totals = {
  ops: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
};

type RunsSnapshot = {
  generated_at: string;
  active: ActiveRun[];
  completed_since_ms: number;
  completed: CompletedRun[];
  totals: Totals;
  by_kind: Record<string, Totals>;
};

// ── Active-run detection (from ps) ───────────────────────────────────────

const KIND_MARKERS: Array<{ kind: string; marker: RegExp }> = [
  { kind: "week_digest",  marker: /weekly retrospective writer/i },
  { kind: "top_session",  marker: /editorial perception layer for ONE session/i },
  { kind: "day_digest",   marker: /single local day into a short, honest narrative/i },
  { kind: "entry_enrich", marker: /per[- ]entry|enrich.{0,40}entry|brief_summary/i },
];

function detectKind(cmdline: string): string {
  for (const { kind, marker } of KIND_MARKERS) {
    if (marker.test(cmdline)) return kind;
  }
  return "unknown";
}

function parseModel(cmdline: string): string {
  const m = cmdline.match(/--model\s+(\S+)/);
  return m ? m[1]! : "?";
}

/** Parse `ps -o etime` output to seconds. Format on Linux/macOS is one of:
 *   MM:SS                — under an hour
 *   HH:MM:SS             — under a day
 *   DD-HH:MM:SS          — multi-day */
function etimeToSec(s: string): number {
  const m = s.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return 0;
  const [, dStr, hStr, mStr, secStr] = m;
  const d = Number(dStr ?? 0);
  const h = Number(hStr ?? 0);
  const min = Number(mStr ?? 0);
  const sec = Number(secStr ?? 0);
  return d * 86400 + h * 3600 + min * 60 + sec;
}

function listActiveRuns(): ActiveRun[] {
  // `etime` is portable across macOS + Linux; `etimes` (seconds) is
  // Linux-only and errors out on Darwin.
  let out = "";
  try {
    out = execSync("ps -axww -o pid,etime,time,command", { encoding: "utf-8" });
  } catch {
    return [];
  }
  const runs: ActiveRun[] = [];
  for (const line of out.split("\n")) {
    if (!line.includes("claude -p")) continue;
    if (!line.includes("--append-system-prompt")) continue;
    if (line.includes("grep")) continue;
    const m = line.trim().match(/^(\d+)\s+(\S+)\s+([\d:.]+)\s+(.+)$/);
    if (!m) continue;
    const [, pidStr, etimeStr, cputime, command] = m;
    runs.push({
      pid: Number(pidStr),
      kind: detectKind(command!),
      model: parseModel(command!),
      elapsed_s: etimeToSec(etimeStr!),
      cpu_time: cputime!,
    });
  }
  return runs.sort((a, b) => a.elapsed_s - b.elapsed_s);
}

// ── Spend log reader ─────────────────────────────────────────────────────

const SPEND_PATH = join(homedir(), ".cclens", "llm-spend.jsonl");

function readSpend(sinceMs: number): CompletedRun[] {
  if (!existsSync(SPEND_PATH)) return [];
  const lines = readFileSync(SPEND_PATH, "utf-8").split("\n").filter(l => l.trim());
  const out: CompletedRun[] = [];
  for (const line of lines) {
    try {
      const r = JSON.parse(line);
      const ts = Date.parse(r.ts);
      if (Number.isNaN(ts) || ts < sinceMs) continue;
      out.push({
        ts: r.ts,
        kind: r.kind ?? "?",
        ref: r.ref ?? "",
        model: r.model ?? "?",
        input_tokens: r.input_tokens ?? 0,
        output_tokens: r.output_tokens ?? 0,
        cost_usd: r.cost_usd ?? 0,
      });
    } catch {
      // skip malformed line
    }
  }
  return out;
}

// ── Snapshot composer ────────────────────────────────────────────────────

function collect(sinceMs: number): RunsSnapshot {
  const active = listActiveRuns();
  const completed = readSpend(sinceMs);
  const totals: Totals = { ops: completed.length, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
  const byKind: Record<string, Totals> = {};
  for (const r of completed) {
    totals.input_tokens += r.input_tokens;
    totals.output_tokens += r.output_tokens;
    totals.cost_usd += r.cost_usd;
    const k = byKind[r.kind] ?? { ops: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
    k.ops += 1;
    k.input_tokens += r.input_tokens;
    k.output_tokens += r.output_tokens;
    k.cost_usd += r.cost_usd;
    byKind[r.kind] = k;
  }
  return {
    generated_at: new Date().toISOString(),
    active,
    completed_since_ms: sinceMs,
    completed,
    totals,
    by_kind: byKind,
  };
}

// ── Text printer ─────────────────────────────────────────────────────────

function fmtElapsed(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${(s % 60).toString().padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60).toString().padStart(2, "0")}m`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function printText(snap: RunsSnapshot): void {
  // ── Active runs ──
  console.log("Active LLM calls");
  console.log("─".repeat(64));
  if (snap.active.length === 0) {
    console.log("  (none)");
  } else {
    console.log(`  ${"PID".padEnd(7)}${"KIND".padEnd(15)}${"MODEL".padEnd(8)}${"ELAPSED".padEnd(10)}CPU TIME`);
    for (const r of snap.active) {
      console.log(`  ${String(r.pid).padEnd(7)}${r.kind.padEnd(15)}${r.model.padEnd(8)}${fmtElapsed(r.elapsed_s).padEnd(10)}${r.cpu_time}`);
    }
  }

  // ── Recent spend totals ──
  const sinceLabel = ageLabel(Date.now() - snap.completed_since_ms);
  console.log(`\nCompleted in last ${sinceLabel}`);
  console.log("─".repeat(64));
  console.log(`  ${snap.totals.ops} calls · in=${fmtTokens(snap.totals.input_tokens)} out=${fmtTokens(snap.totals.output_tokens)} · $${snap.totals.cost_usd.toFixed(4)}`);

  if (Object.keys(snap.by_kind).length > 0) {
    console.log();
    console.log(`  ${"KIND".padEnd(15)}${"OPS".padEnd(7)}${"INPUT".padEnd(11)}${"OUTPUT".padEnd(11)}COST`);
    const kinds = Object.entries(snap.by_kind).sort((a, b) => b[1].cost_usd - a[1].cost_usd);
    for (const [k, t] of kinds) {
      console.log(`  ${k.padEnd(15)}${String(t.ops).padEnd(7)}${fmtTokens(t.input_tokens).padEnd(11)}${fmtTokens(t.output_tokens).padEnd(11)}$${t.cost_usd.toFixed(4)}`);
    }
  }

  // ── Recent calls (last 5) ──
  if (snap.completed.length > 0) {
    console.log("\nRecent completions");
    console.log("─".repeat(64));
    const recent = [...snap.completed].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, 5);
    for (const r of recent) {
      const t = new Date(r.ts).toLocaleTimeString("en-US", { hour12: false });
      const ref = r.ref.length > 28 ? `${r.ref.slice(0, 25)}…` : r.ref;
      console.log(`  ${t}  ${r.kind.padEnd(15)}${ref.padEnd(30)}out=${fmtTokens(r.output_tokens).padStart(7)}  $${r.cost_usd.toFixed(4)}`);
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function parseSince(s: string): number {
  // Accepts "24h", "30m", "7d", or an ISO timestamp.
  const m = s.match(/^(\d+)([smhd])$/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    const mult = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
    return Date.now() - n * mult;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return t;
  // Default fallback: 24h
  return Date.now() - 24 * 3_600_000;
}

function ageLabel(ms: number): string {
  if (ms < 60_000) return "1m";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}
