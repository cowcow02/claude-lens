import { listSessions, getSession, loadUsageByDay } from "@claude-lens/parser/fs";
import {
  buildCapsule,
  buildPeriodBundle,
  aggregateConcurrency,
  calendarWeek,
  last4CompletedWeeks,
  computeBurstsFromSessions,
  type SessionCapsule,
  type PeriodBundle,
} from "@claude-lens/parser";
import { parseDateArg, flag } from "../args.js";

export async function stats(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const json = args.includes("--json") || !args.includes("--pretty");
  const pretty = args.includes("--pretty");

  let range: { start: Date; end: Date; range_type: "week" | "4weeks" | "custom" };
  if (args.includes("--week")) {
    range = { ...calendarWeek(), range_type: "week" };
  } else if (args.includes("--4weeks")) {
    range = { ...last4CompletedWeeks(), range_type: "4weeks" };
  } else {
    const sinceArg = parseDateArg(flag(args, "--since"));
    const untilArg = parseDateArg(flag(args, "--until"));
    const daysArg = flag(args, "--days");
    let start = sinceArg;
    let end = untilArg ?? new Date();
    if (!start && daysArg) {
      const d = parseInt(daysArg, 10);
      if (Number.isFinite(d) && d > 0) {
        start = new Date();
        start.setDate(start.getDate() - d);
        start.setHours(0, 0, 0, 0);
      }
    }
    if (!start) {
      // Default to the current calendar week
      range = { ...calendarWeek(), range_type: "week" };
    } else {
      range = { start, end, range_type: "custom" };
    }
  }

  const bundle = await buildBundle(range);

  if (json) {
    process.stdout.write(JSON.stringify(bundle, null, pretty ? 2 : 0));
    if (pretty) process.stdout.write("\n");
  } else {
    printSummary(bundle);
  }
}

async function buildBundle(range: {
  start: Date;
  end: Date;
  range_type: "week" | "4weeks" | "custom";
}): Promise<PeriodBundle> {
  const metas = await listSessions({ limit: 10000 });
  const inRange = metas.filter((m) => {
    if (!m.firstTimestamp) return false;
    const t = new Date(m.firstTimestamp).getTime();
    return t >= range.start.getTime() && t <= range.end.getTime();
  });

  const caps: SessionCapsule[] = [];
  let trivial = 0;
  const CONCURRENCY = 8;
  for (let i = 0; i < inRange.length; i += CONCURRENCY) {
    const slice = inRange.slice(i, i + CONCURRENCY);
    const results = await Promise.all(slice.map(async (m) => {
      try {
        const d = await getSession(m.id);
        if (!d) return null;
        return buildCapsule(d, { compact: true });
      } catch { return null; }
    }));
    for (const cap of results) {
      if (!cap) continue;
      if (cap.outcome === "trivial") trivial++;
      else caps.push(cap);
    }
  }

  const bundle = buildPeriodBundle(caps, {
    period: range,
    trivial_dropped: trivial,
    sessions_total: inRange.length,
  });

  bundle.concurrency = aggregateConcurrency(computeBurstsFromSessions(inRange), range);

  // Usage by day
  try {
    bundle.usage = await loadUsageByDay(range.start, range.end);
  } catch {
    /* usage is optional */
  }

  return bundle;
}

function printSummary(b: PeriodBundle): void {
  console.log(`Insight aggregates · ${b.period.label} (${b.period.range_type})`);
  console.log(`  ${b.counts.substantive} substantive · ${b.counts.trivial_dropped} trivial dropped · ${b.counts.sessions_total} total`);
  console.log(`  ${b.totals.agent_min.toFixed(0)}m agent time · ${b.totals.prs} PRs · ${b.totals.commits} commits · ${b.totals.subagent_calls} subagents`);
  console.log("");
  console.log("By day:");
  for (const d of b.by_day) {
    const bar = "█".repeat(Math.min(40, Math.round(d.agent_min / 15)));
    console.log(`  ${d.day_name} ${d.date}  ${String(d.agent_min).padStart(5)}m  ${d.sessions} sess  ${bar}`);
  }
  console.log("");
  console.log("Top projects:");
  for (const p of b.project_shares.slice(0, 6)) {
    console.log(`  ${String(p.share_pct).padStart(3)}%  ${p.display_name.padEnd(42)}  ${p.prs} PR  ${p.commits} commits`);
  }
  if (b.shipped_prs.length > 0) {
    console.log("");
    console.log("Shipped:");
    for (const s of b.shipped_prs) {
      console.log(`  ${s.title} · ${s.active_min.toFixed(0)}m · ${s.flags.join(",") || "—"}`);
    }
  }
  if (b.concurrency) {
    console.log("");
    console.log(`Concurrency: peak ×${b.concurrency.peak} on ${b.concurrency.peak_day ?? "—"} · ${b.concurrency.multi_agent_days} multi-agent days · ${b.concurrency.cross_project_days} cross-project`);
  }
  if (b.usage) {
    const hot = b.usage.by_day.filter((d) => d.peak_util_pct > 0);
    if (hot.length > 0) {
      console.log(`Usage: peak ${Math.max(...hot.map((d) => d.peak_util_pct))}% (${hot.length} active days)`);
    }
  }
  console.log("");
  console.log("Flags:", Object.entries(b.flags_count).map(([k, v]) => `${k}×${v}`).join(", ") || "—");
}

function printHelp(): void {
  console.log(`fleetlens stats — period aggregates for the insights pipeline

Usage:
  fleetlens stats [--week | --4weeks | --since DATE --until DATE | --days N]
                  [--json | --pretty]

Range selection:
  --week          Current Monday-Sunday calendar week (default).
  --4weeks        Last 28 days ending with this week's Sunday.
  --since DATE    inclusive start (YYYYMMDD or YYYY-MM-DD)
  --until DATE    inclusive end (default: now)
  --days N        alternative to --since (last N days)

Output:
  --json          (default when piped) structured JSON — the second half
                  of the insight LLM payload. Matches the PeriodBundle
                  type in @claude-lens/parser.
  --pretty        human-readable terminal summary.

Examples:
  fleetlens stats --week --pretty
  fleetlens stats --week --json | jq '.concurrency'
  fleetlens stats --since 2026-04-14 --until 2026-04-20 --json > /tmp/bundle.json`);
}
