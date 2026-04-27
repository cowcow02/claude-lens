import { calendarMonth, priorCalendarMonth } from "@claude-lens/parser";
import { listEntryKeys, listMonthDigestKeys, readMonthDigest } from "@claude-lens/entries/fs";
import { parseEntryKey } from "@claude-lens/entries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MonthRow = {
  year: number;
  month: number;
  start: string;
  end: string;
  label: string;
  active_days: number;
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

function yearMonthKey(start: Date): string {
  const y = start.getFullYear();
  const m = String(start.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function label(start: Date): string {
  return start.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const count = Math.min(12, Math.max(1, parseInt(url.searchParams.get("count") ?? "6", 10)));

  const cachedKeys = new Set(listMonthDigestKeys());

  const entryDays = new Set<string>();
  for (const key of listEntryKeys()) {
    const parsed = parseEntryKey(key);
    if (parsed) entryDays.add(parsed.local_day);
  }

  const current = calendarMonth();
  const prior = priorCalendarMonth();

  const months: MonthRow[] = [];
  for (let i = 0; i < count; i++) {
    let start: Date, end: Date, in_progress: boolean;
    if (i === 0) {
      start = current.start; end = current.end; in_progress = true;
    } else {
      const refMonth = new Date(prior.start);
      refMonth.setMonth(refMonth.getMonth() - (i - 1));
      start = new Date(refMonth.getFullYear(), refMonth.getMonth(), 1);
      end = new Date(refMonth.getFullYear(), refMonth.getMonth() + 1, 0);
      in_progress = false;
    }
    let active_days = 0;
    const cursor = new Date(start);
    while (cursor.getTime() <= end.getTime()) {
      if (entryDays.has(isoDay(cursor))) active_days++;
      cursor.setDate(cursor.getDate() + 1);
    }
    const ymKey = yearMonthKey(start);
    const savedKey = cachedKeys.has(ymKey) ? `month-${ymKey}` : null;

    let headline: string | null = null;
    let shipped_count = 0;
    let agent_min = 0;
    if (savedKey) {
      const digest = readMonthDigest(ymKey);
      if (digest) {
        headline = digest.headline;
        shipped_count = digest.shipped.length;
        agent_min = Math.round(digest.agent_min_total);
      }
    }

    months.push({
      year: start.getFullYear(),
      month: start.getMonth() + 1,
      start: isoDay(start),
      end: isoDay(end),
      label: label(start),
      active_days,
      in_progress,
      saved_key: savedKey,
      headline,
      shipped_count,
      agent_min,
    });
  }

  return Response.json({ months });
}
