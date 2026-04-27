import { listSessions, getSession } from "@/lib/data";
import {
  buildGanttDay,
  computeParallelismBursts,
  type GanttDay,
  type ParallelismBurst,
} from "@claude-lens/parser";
import { readDayDigest, listEntriesForDay } from "@claude-lens/entries/fs";
import { readSettings, buildDeterministicDigest } from "@claude-lens/entries/node";
import type { DayDigest } from "@claude-lens/entries";
import { isValidDate, todayLocal } from "@/lib/entries";
import { buildEntriesIndex } from "@/lib/entries-index";
import type { SessionEntrySummary } from "../../parallelism/gantt-chart";
import { DayView } from "./day-view";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, d, 12);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
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

  return (
    <div>
      <nav style={{
        padding: "14px 40px", display: "flex", gap: 14, fontSize: 12,
        borderBottom: "1px solid var(--af-border-subtle)", alignItems: "center",
      }}>
        <Link href={`/day/${prev}`} style={{ color: "var(--af-accent)" }}>← Prev day</Link>
        {next <= today && <Link href={`/day/${next}`} style={{ color: "var(--af-accent)" }}>Next day →</Link>}
        {date !== today && (
          <Link href={`/day/${today}`} style={{ marginLeft: "auto", color: "var(--af-accent)" }}>
            Today →
          </Link>
        )}
      </nav>
      <DayView
        date={date}
        initial={initial}
        entries={entries}
        aiEnabled={aiEnabled}
        gantt={gantt}
        bursts={bursts}
        sessionEntries={sessionEntries}
      />
    </div>
  );
}
