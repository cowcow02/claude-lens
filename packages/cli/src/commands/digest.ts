import { flag } from "../args.js";
import { listEntriesForDay, readDayDigest, writeDayDigest } from "@claude-lens/entries/fs";
import {
  buildDeterministicDigest, generateDayDigest,
  readSettings, appendSpend, monthToDateSpend,
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
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    if (args[0] !== "day") { printHelp(); return; }
  }

  if (args[0] === "day") {
    await day(args.slice(1));
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

  let result: DayDigest;

  if (date === toLocalDay(now)) {
    // Today: always built fresh; never persisted to disk
    result = await generateOrDeterministic(date, entries, aiOn, settings);
  } else {
    // Past day: read cache unless --force
    if (!force) {
      const cached = readDayDigest(date);
      if (cached) result = cached;
      else {
        result = await generateOrDeterministic(date, entries, aiOn, settings);
        writeDayDigest(result);
      }
    } else {
      result = await generateOrDeterministic(date, entries, aiOn, settings);
      writeDayDigest(result);
    }
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    prettyPrint(result);
  }
}

async function generateOrDeterministic(
  date: string, entries: Entry[], aiOn: boolean,
  settings: ReturnType<typeof readSettings>,
): Promise<DayDigest> {
  if (!aiOn) return buildDeterministicDigest(date, entries);

  const budget = settings.ai_features.monthlyBudgetUsd ?? Infinity;
  if (monthToDateSpend() >= budget) {
    console.error(`budget cap reached — falling back to deterministic digest`);
    return buildDeterministicDigest(date, entries);
  }

  const r = await generateDayDigest(date, entries, { model: settings.ai_features.model });
  if (r.usage) {
    appendSpend({
      ts: new Date().toISOString(), caller: "cli",
      model: r.digest.model ?? settings.ai_features.model,
      input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens,
      cost_usd: r.digest.cost_usd ?? 0, kind: "day_digest", ref: date,
    });
  }
  return r.digest;
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

Exit codes:
  0 — success
  1 — invalid date, or no entries for date
`);
}
