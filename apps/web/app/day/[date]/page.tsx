import { listSessions, getSession } from "@/lib/data";
import {
  buildGanttDay,
  computeParallelismBursts,
  computeBurstsFromSessions,
  dailyActivity,
  type GanttDay,
  type ParallelismBurst,
} from "@claude-lens/parser";
import { toLocalDay as toLocalDayParser } from "@claude-lens/parser";
import { readDayDigest, listEntriesForDay } from "@claude-lens/entries/fs";
import { readSettings, buildDeterministicDigest } from "@claude-lens/entries/node";
import type { DayDigest } from "@claude-lens/entries";
import { isValidDate, todayLocal, toLocalDay } from "@/lib/entries";
import { buildEntriesIndex } from "@/lib/entries-index";
import type { SessionEntrySummary } from "../../parallelism/gantt-chart";
import type { BackfillRow } from "@/components/backfill-drawer";
import type { DayInfo } from "@/components/date-nav";
import { DayView } from "./day-view";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

const BACKFILL_DAYS = 30;

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, d, 12);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function buildBackfillRows(): BackfillRow[] {
  const out: BackfillRow[] = [];
  const now = Date.now();
  for (let i = 0; i < BACKFILL_DAYS; i++) {
    const d = toLocalDay(now - i * 86_400_000);
    const entries = listEntriesForDay(d);
    const digest = readDayDigest(d);
    const status: BackfillRow["status"] = entries.length === 0 ? "empty"
      : digest && digest.headline ? "generated"
      : "pending";
    const label = i === 0 ? "Today"
      : i === 1 ? "Yesterday"
      : new Date(`${d}T12:00:00`).toLocaleDateString("en-US", {
          weekday: "short", month: "short", day: "numeric",
        });
    out.push({
      date: d,
      day_label: label,
      entry_count: entries.length,
      pr_count: entries.reduce((s, e) => s + e.pr_titles.length, 0),
      status,
    });
  }
  return out;
}

export default async function DayPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!isValidDate(date)) return notFound();

  const today = todayLocal();
  if (date > today) {
    return (
      <div style={{ padding: "40px" }}>
        <h1>Future date</h1>
        <p>Day views only exist for past and current days.</p>
        <Link href={`/day/${today}`}>Go to today →</Link>
      </div>
    );
  }

  // ---- Narrative side (digest + entries) ----
  const settings = readSettings();
  const aiEnabled = settings.ai_features.enabled;
  const entries = listEntriesForDay(date);
  let initial: DayDigest | null = null;
  if (date !== today) initial = readDayDigest(date);
  if (!initial && entries.length > 0) initial = buildDeterministicDigest(date, entries);

  // ---- Timeline side (Gantt) ----
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dayStartMs = new Date(y, m - 1, d).getTime();
  const dayEndMs = new Date(y, m - 1, d + 1).getTime();
  const filterStartMs = dayStartMs - 24 * 60 * 60 * 1000;
  const filterEndMs = dayEndMs + 24 * 60 * 60 * 1000;
  const allSessions = await listSessions();
  const candidates = allSessions.filter((s) => {
    if (!s.firstTimestamp) return false;
    const startMs = Date.parse(s.firstTimestamp);
    if (Number.isNaN(startMs)) return false;
    const endMs = s.lastTimestamp ? Date.parse(s.lastTimestamp) : startMs;
    return endMs >= filterStartMs && startMs <= filterEndMs;
  });
  const details = (
    await Promise.all(candidates.slice(0, 80).map((s) => getSession(s.id)))
  ).filter((d): d is NonNullable<typeof d> => !!d);
  const gantt: GanttDay = buildGanttDay(details, date);
  const bursts: ParallelismBurst[] = computeParallelismBursts(gantt);

  const entriesIndex = await buildEntriesIndex();
  const sessionEntries: Record<string, SessionEntrySummary> = {};
  for (const s of gantt.sessions) {
    const list = entriesIndex.bySession.get(s.id) ?? [];
    const e = list.find((e) => e.local_day === date);
    if (!e) continue;
    sessionEntries[s.id] = {
      outcome: e.enrichment.outcome ?? null,
      briefSummary: e.enrichment.brief_summary ?? null,
      enrichmentStatus: e.enrichment.status,
      localDay: e.local_day,
    };
  }

  const prev = addDays(date, -1);
  const next = addDays(date, 1);
  const backfillRows = buildBackfillRows();

  // Calendar popover stats: per-day activity + parallelism stats so the
  // calendar tints by airtime and dots days with concurrency bursts.
  const buckets = dailyActivity(allSessions);
  const allBursts = computeBurstsFromSessions(allSessions);
  type DayBurstAgg = { totalMs: number; count: number; peak: number };
  const burstsByDay = new Map<string, DayBurstAgg>();
  for (const b of allBursts) {
    const day = toLocalDayParser(b.startMs);
    const e = burstsByDay.get(day) ?? { totalMs: 0, count: 0, peak: 0 };
    e.totalMs += b.endMs - b.startMs;
    e.count += 1;
    if (b.peak > e.peak) e.peak = b.peak;
    burstsByDay.set(day, e);
  }
  const dayKeys = new Set<string>();
  for (const b of buckets) if (b.sessions > 0) dayKeys.add(b.date);
  for (const d of burstsByDay.keys()) dayKeys.add(d);
  const dayStats: DayInfo[] = Array.from(dayKeys).map((dt) => {
    const a = buckets.find((b) => b.date === dt);
    const burst = burstsByDay.get(dt);
    return {
      date: dt,
      sessions: a?.sessions ?? 0,
      airTimeMs: a?.airTimeMs ?? 0,
      parallelMs: burst?.totalMs ?? 0,
      burstCount: burst?.count ?? 0,
      peakConcurrency: burst?.peak ?? 0,
    };
  });

  return (
    <DayView
      date={date}
      today={today}
      prev={prev}
      next={next <= today ? next : null}
      initial={initial}
      entries={entries}
      aiEnabled={aiEnabled}
      gantt={gantt}
      bursts={bursts}
      sessionEntries={sessionEntries}
      backfillRows={backfillRows}
      dayStats={dayStats}
    />
  );
}
