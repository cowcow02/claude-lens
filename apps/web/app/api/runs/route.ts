import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/runs?since=24h
 *
 * Mirrors `fleetlens runs --json`. Returns a snapshot of currently-running
 * LLM subprocesses (week_digest / top_session / day_digest / entry_enrich)
 * plus aggregated token spend in the requested window.
 */

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

type ActiveRun = {
  pid: number;
  kind: string;
  model: string;
  elapsed_s: number;
  cpu_time: string;
};

function etimeToSec(s: string): number {
  const m = s.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return 0;
  const [, dStr, hStr, mStr, secStr] = m;
  return Number(dStr ?? 0) * 86400 + Number(hStr ?? 0) * 3600 + Number(mStr ?? 0) * 60 + Number(secStr ?? 0);
}

function listActiveRuns(): ActiveRun[] {
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

const SPEND_PATH = join(homedir(), ".cclens", "llm-spend.jsonl");

type CompletedRun = {
  ts: string;
  kind: string;
  ref: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
};

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
    } catch { /* skip */ }
  }
  return out;
}

function parseSince(s: string | null): number {
  if (!s) return Date.now() - 24 * 3_600_000;
  const m = s.match(/^(\d+)([smhd])$/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    const mult = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
    return Date.now() - n * mult;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return t;
  return Date.now() - 24 * 3_600_000;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const sinceMs = parseSince(url.searchParams.get("since"));
  const active = listActiveRuns();
  const completed = readSpend(sinceMs);

  type Totals = { ops: number; input_tokens: number; output_tokens: number; cost_usd: number };
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

  return new Response(JSON.stringify({
    generated_at: new Date().toISOString(),
    active,
    completed_since_ms: sinceMs,
    totals,
    by_kind: byKind,
    completed,
  }, null, 2), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
