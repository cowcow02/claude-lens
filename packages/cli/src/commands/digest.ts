import { flag } from "../args.js";
import { listEntriesForDay, readDayDigest } from "@claude-lens/entries/fs";
import {
  buildDeterministicDigest,
  readSettings,
  runDayDigestPipeline,
} from "@claude-lens/entries/node";
import type { DayDigest, Entry } from "@claude-lens/entries";

function toLocalDay(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function digest(args: string[]): Promise<void> {
  if (args[0] === "day") {
    await day(args.slice(1));
    return;
  }

  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    printHelp();
    return;
  }

  console.error(`unknown digest subcommand: ${args[0] ?? "(none)"}`);
  printHelp();
  process.exit(1);
}

async function day(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const force = args.includes("--force");
  const isToday = args.includes("--today");
  const dateFlag = flag(args, "--date");

  const now = Date.now();
  const date = dateFlag
    ?? (isToday ? toLocalDay(now) : toLocalDay(now - 86_400_000));

  if (!DATE_RE.test(date)) {
    console.error(`invalid date: "${date}" (expected YYYY-MM-DD)`);
    process.exit(1);
  }

  const entries = listEntriesForDay(date) as Entry[];
  if (entries.length === 0) {
    if (json) console.log(JSON.stringify({ error: "no entries for date", date }));
    else console.error(`no entries found for ${date}`);
    process.exit(1);
  }

  const settings = readSettings();
  const aiOn = settings.ai_features.enabled && process.env.CCLENS_AI_DISABLED !== "1";
  const todayLocalDay = toLocalDay(now);

  // Fast path: past day + cached + !force + AI mode matches how it was cached.
  // Use cached file directly. Otherwise delegate to the shared pipeline.
  let result: DayDigest | null = null;

  if (!force && date !== todayLocalDay) {
    const cached = readDayDigest(date);
    if (cached) result = cached;
  }

  if (!result) {
    if (!aiOn) {
      // Deterministic-only path — no need for pipeline machinery.
      result = buildDeterministicDigest(date, entries);
    } else {
      // Full pipeline: enriches pending entries, runs synth, writes cache.
      // Stream events to stderr so user sees progress.
      const log = (msg: string) => { if (!json) process.stderr.write(`  ${msg}\n`); };
      for await (const ev of runDayDigestPipeline(date, {
        settings: settings.ai_features,
        force,
        todayLocalDay,
        caller: "cli",
      })) {
        if (ev.type === "status") log(`[${ev.phase}] ${ev.text}`);
        else if (ev.type === "entry") log(`  entry ${ev.index}/${ev.total} · ${ev.session_id.slice(0, 8)} · ${ev.status}${ev.cost_usd ? ` ($${ev.cost_usd.toFixed(4)})` : ""}`);
        else if (ev.type === "saved") log(`saved to ${ev.path}`);
        else if (ev.type === "digest") result = ev.digest;
        else if (ev.type === "error") {
          console.error(`error: ${ev.message}`);
          process.exit(1);
        }
      }
    }
  }

  if (!result) {
    console.error(`pipeline produced no digest for ${date}`);
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    prettyPrint(result);
  }
}

function prettyPrint(d: DayDigest): void {
  console.log(`\n${d.key}  ${Math.round(d.agent_min)}m  ${d.projects.length} project${d.projects.length === 1 ? "" : "s"}  ${d.shipped.length} PR${d.shipped.length === 1 ? "" : "s"}`);
  if (d.headline) console.log(`\n  ${d.headline}\n`);
  if (d.narrative) console.log(`  ${d.narrative}\n`);
  if (d.what_went_well) console.log(`  ✓ ${d.what_went_well}`);
  if (d.what_hit_friction) console.log(`  ⚠ ${d.what_hit_friction}`);
  if (d.suggestion) console.log(`\n  → ${d.suggestion.headline}\n    ${d.suggestion.body}`);
  console.log("");
}

function printHelp(): void {
  console.log(`fleetlens digest — day-level perception digests

Usage:
  fleetlens digest day                        Yesterday (default)
  fleetlens digest day --yesterday            Yesterday
  fleetlens digest day --today                Today (in-memory only, not cached)
  fleetlens digest day --date YYYY-MM-DD      Specific date
  fleetlens digest day --date X --force       Re-generate, overwrite cache
  fleetlens digest day --date X --json        JSON output for scripting

AI-on path: enriches pending entries first, then synthesizes the day narrative.
Progress streams to stderr unless --json.

Exit codes:
  0 — success
  1 — invalid date, no entries, or pipeline error
`);
}
