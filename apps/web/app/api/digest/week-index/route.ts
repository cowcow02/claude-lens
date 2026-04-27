import { listSessions } from "@claude-lens/parser/fs";
import { calendarWeek, priorCalendarWeek } from "@claude-lens/parser";
import { listWeekDigestKeys, readWeekDigest } from "@claude-lens/entries/fs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type WeekRow = {
  iso_week: number;
  start: string;
  end: string;
  label: string;
  sessions: number;
  in_progress: boolean;
  saved_key: string | null;
  headline: string | null;
  shipped_count: number;
  agent_min: number;
};

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isoWeekNo(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil((((t.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

function label(start: Date, end: Date): string {
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const count = Math.min(26, Math.max(1, parseInt(url.searchParams.get("count") ?? "12", 10)));

  const metas = await listSessions({ limit: 10000 });
  const cachedKeys = new Set(listWeekDigestKeys());

  const current = calendarWeek();
  const prior = priorCalendarWeek();

  const weeks: WeekRow[] = [];
  for (let i = 0; i < count; i++) {
    let start: Date, end: Date, in_progress: boolean;
    if (i === 0) {
      start = current.start; end = current.end; in_progress = true;
    } else {
      const offset = (i - 1) * 7;
      start = new Date(prior.start); start.setDate(prior.start.getDate() - offset);
      end = new Date(prior.end); end.setDate(prior.end.getDate() - offset);
      in_progress = false;
    }
    const startMs = start.getTime();
    const endMs = new Date(end).setHours(23, 59, 59, 999);
    const sessions = metas.filter((m) => {
      if (!m.firstTimestamp) return false;
      const t = Date.parse(m.firstTimestamp);
      return !Number.isNaN(t) && t >= startMs && t <= endMs;
    }).length;
    const startKey = isoDay(start);
    const savedKey = cachedKeys.has(startKey) ? `week-${startKey}` : null;

    let headline: string | null = null;
    let shipped_count = 0;
    let agent_min = 0;
    if (savedKey) {
      const digest = readWeekDigest(startKey);
      if (digest) {
        headline = digest.headline;
        shipped_count = digest.shipped.length;
        agent_min = Math.round(digest.agent_min_total);
      }
    }

    weeks.push({
      iso_week: isoWeekNo(start),
      start: startKey,
      end: isoDay(end),
      label: label(start, end),
      sessions,
      in_progress,
      saved_key: savedKey,
      headline,
      shipped_count,
      agent_min,
    });
  }

  return Response.json({ weeks });
}
