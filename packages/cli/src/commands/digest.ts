import { flag } from "../args.js";
import { listEntriesForDay, readDayDigest, readWeekDigest, readMonthDigest } from "@claude-lens/entries/fs";
import {
  buildDeterministicDigest,
  readSettings,
  runDayDigestPipeline,
  runWeekDigestPipeline,
  runMonthDigestPipeline,
} from "@claude-lens/entries/node";
import type { DayDigest, Entry, WeekDigest, MonthDigest } from "@claude-lens/entries";

function toLocalDay(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function digest(args: string[]): Promise<void> {
  if (args[0] === "day") { await day(args.slice(1)); return; }
  if (args[0] === "week") { await week(args.slice(1)); return; }
  if (args[0] === "month") { await month(args.slice(1)); return; }

  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    printHelp();
    return;
  }

  console.error(`unknown digest subcommand: ${args[0] ?? "(none)"}`);
  printHelp();
  process.exit(1);
}

function mondayOf(localDay: string): string {
  const d = new Date(`${localDay}T00:00:00`);
  const dow = d.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offset);
  return toLocalDay(d.getTime());
}

async function week(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const force = args.includes("--force");
  const isThisWeek = args.includes("--this-week");
  const weekFlag = flag(args, "--week");

  const now = Date.now();
  const todayLocalDay = toLocalDay(now);
  const currentWeekMonday = mondayOf(todayLocalDay);
  const lastWeekMonday = (() => {
    const d = new Date(`${currentWeekMonday}T00:00:00`);
    d.setDate(d.getDate() - 7);
    return toLocalDay(d.getTime());
  })();

  let monday: string;
  if (weekFlag) {
    if (!DATE_RE.test(weekFlag)) {
      console.error(`invalid week start: "${weekFlag}" (expected YYYY-MM-DD)`);
      process.exit(1);
    }
    monday = mondayOf(weekFlag);
  } else if (isThisWeek) {
    monday = currentWeekMonday;
  } else {
    monday = lastWeekMonday;
  }

  const settings = readSettings();
  let result: WeekDigest | null = null;
  if (!force && monday !== currentWeekMonday) {
    const cached = readWeekDigest(monday);
    if (cached) result = cached;
  }

  if (!result) {
    const log = (msg: string) => { if (!json) process.stderr.write(`  ${msg}\n`); };
    for await (const ev of runWeekDigestPipeline(monday, {
      settings: settings.ai_features,
      force,
      currentWeekMonday,
      todayLocalDay,
      caller: "cli",
    })) {
      if (ev.type === "status") log(`[${ev.phase}] ${ev.text}`);
      else if (ev.type === "dependency") log(`  ${ev.kind} ${ev.key} ${ev.status}`);
      else if (ev.type === "entry") log(`  entry ${ev.index}/${ev.total} · ${ev.status}`);
      else if (ev.type === "saved") log(`saved to ${ev.path}`);
      else if (ev.type === "digest" && ev.digest.scope === "week") result = ev.digest as WeekDigest;
      else if (ev.type === "error") { console.error(`error: ${ev.message}`); process.exit(1); }
    }
  }

  if (!result) { console.error(`pipeline produced no week digest for ${monday}`); process.exit(1); }

  if (json) console.log(JSON.stringify(result, null, 2));
  else prettyPrintWeek(result);
}

async function month(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const force = args.includes("--force");
  const isThisMonth = args.includes("--this-month");
  const monthFlag = flag(args, "--month");

  const now = Date.now();
  const todayLocalDay = toLocalDay(now);
  const currentWeekMonday = mondayOf(todayLocalDay);
  const currentYearMonth = todayLocalDay.slice(0, 7);
  const lastMonth = (() => {
    const [y, m] = todayLocalDay.split("-");
    const yi = Number(y);
    const mi = Number(m);
    if (mi === 1) return `${yi - 1}-12`;
    return `${yi}-${String(mi - 1).padStart(2, "0")}`;
  })();

  let yearMonth: string;
  if (monthFlag) {
    if (!/^\d{4}-\d{2}$/.test(monthFlag)) {
      console.error(`invalid year-month: "${monthFlag}" (expected YYYY-MM)`);
      process.exit(1);
    }
    yearMonth = monthFlag;
  } else if (isThisMonth) {
    yearMonth = currentYearMonth;
  } else {
    yearMonth = lastMonth;
  }

  const settings = readSettings();
  let result: MonthDigest | null = null;
  if (!force && yearMonth !== currentYearMonth) {
    const cached = readMonthDigest(yearMonth);
    if (cached) result = cached;
  }

  if (!result) {
    const log = (msg: string) => { if (!json) process.stderr.write(`  ${msg}\n`); };
    for await (const ev of runMonthDigestPipeline(yearMonth, {
      settings: settings.ai_features,
      force,
      currentYearMonth,
      currentWeekMonday,
      todayLocalDay,
      caller: "cli",
    })) {
      if (ev.type === "status") log(`[${ev.phase}] ${ev.text}`);
      else if (ev.type === "dependency") log(`  ${ev.kind} ${ev.key} ${ev.status}`);
      else if (ev.type === "entry") log(`  entry ${ev.index}/${ev.total} · ${ev.status}`);
      else if (ev.type === "saved") log(`saved to ${ev.path}`);
      else if (ev.type === "digest" && ev.digest.scope === "month") result = ev.digest as MonthDigest;
      else if (ev.type === "error") { console.error(`error: ${ev.message}`); process.exit(1); }
    }
  }

  if (!result) { console.error(`pipeline produced no month digest for ${yearMonth}`); process.exit(1); }

  if (json) console.log(JSON.stringify(result, null, 2));
  else prettyPrintMonth(result);
}

function prettyPrintWeek(d: WeekDigest): void {
  const totalDays = Object.values(d.outcome_mix).reduce((a, b) => a + (b ?? 0), 0);
  console.log(`\nWeek of ${d.key}  ${Math.round(d.agent_min_total)}m  ${totalDays} active day${totalDays === 1 ? "" : "s"}  ${d.shipped.length} PR${d.shipped.length === 1 ? "" : "s"}`);
  if (d.headline) console.log(`\n  ${d.headline}\n`);
  if (d.trajectory) {
    for (const t of d.trajectory) console.log(`  ${t.date}  ${t.line}`);
    console.log("");
  }
  if (d.standout_days) for (const s of d.standout_days) console.log(`  ★ ${s.date}  ${s.why}`);
  if (d.friction_themes) console.log(`\n  ⚠ ${d.friction_themes}`);
  if (d.suggestion) console.log(`\n  → ${d.suggestion.headline}\n    ${d.suggestion.body}`);
  console.log("");
}

function prettyPrintMonth(d: MonthDigest): void {
  const totalDays = Object.values(d.outcome_mix).reduce((a, b) => a + (b ?? 0), 0);
  console.log(`\n${d.key}  ${Math.round(d.agent_min_total)}m  ${totalDays} active day${totalDays === 1 ? "" : "s"}  ${d.shipped.length} PR${d.shipped.length === 1 ? "" : "s"}`);
  if (d.headline) console.log(`\n  ${d.headline}\n`);
  if (d.trajectory) {
    for (const t of d.trajectory) console.log(`  Week ${t.week_start}  ${t.line}`);
    console.log("");
  }
  if (d.standout_weeks) for (const s of d.standout_weeks) console.log(`  ★ Week ${s.week_start}  ${s.why}`);
  if (d.friction_themes) console.log(`\n  ⚠ ${d.friction_themes}`);
  if (d.suggestion) console.log(`\n  → ${d.suggestion.headline}\n    ${d.suggestion.body}`);
  console.log("");
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
        else if (ev.type === "digest" && ev.digest.scope === "day") result = ev.digest as DayDigest;
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
  console.log(`fleetlens digest — perception-layer digests at day, week, and month scope

Usage:
  fleetlens digest day                              Yesterday (default)
  fleetlens digest day --today                      Today (in-memory only)
  fleetlens digest day --date YYYY-MM-DD            Specific date

  fleetlens digest week                             Last completed week (default)
  fleetlens digest week --this-week                 Current week (in-memory only)
  fleetlens digest week --week YYYY-MM-DD           Week containing this date

  fleetlens digest month                            Last completed month (default)
  fleetlens digest month --this-month               Current month (in-memory only)
  fleetlens digest month --month YYYY-MM            Specific calendar month

Common flags:
  --force                                          Re-generate, overwrite cache
  --json                                           JSON output for scripting

Week digests consume day digests (auto-filling missing past days).
Month digests consume week digests. Progress streams to stderr unless --json.

Exit codes:
  0 — success
  1 — invalid input, no data, or pipeline error
`);
}
