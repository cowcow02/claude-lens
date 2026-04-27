import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import {
  readSettings, readWeekDigest, readMonthDigest,
  getCurrentWeekDigestFromCache, getCurrentMonthDigestFromCache,
} from "@claude-lens/entries/node";
import { WeekDigestView } from "@/components/week-digest-view";
import { MonthDigestView } from "@/components/month-digest-view";
import { currentWeekMonday, currentYearMonth } from "@/lib/entries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WEEK_KEY = /^week-(\d{4}-\d{2}-\d{2})$/;
const MONTH_KEY = /^month-(\d{4}-\d{2})$/;

export default async function SavedInsightPage({
  params,
}: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const aiOn = readSettings().ai_features.enabled;

  const weekMatch = WEEK_KEY.exec(key);
  if (weekMatch) {
    const monday = weekMatch[1]!;
    // Current week lives only in the 10-min in-memory TTL cache; fall through
    // to disk only for past weeks.
    const cached = monday === currentWeekMonday()
      ? getCurrentWeekDigestFromCache(monday, Date.now())
      : readWeekDigest(monday);

    const prev = shiftMonday(monday, -7);
    const nextRaw = shiftMonday(monday, +7);
    const today = currentWeekMonday();
    const nextMonday = nextRaw > today ? null : nextRaw;
    const priorDigest = readWeekDigest(prev);
    const prevCached = !!priorDigest;
    const nextCached = nextMonday ? !!readWeekDigest(nextMonday) : false;

    return (
      <div>
        <TopNav
          label={`Week of ${monday}`}
          prev={{ key: `week-${prev}`, label: shortLabelMonday(prev), cached: prevCached }}
          next={nextMonday ? { key: `week-${nextMonday}`, label: shortLabelMonday(nextMonday), cached: nextCached } : null}
        />
        <WeekDigestView initial={cached} monday={monday} aiEnabled={aiOn} prior={priorDigest} />
      </div>
    );
  }

  const monthMatch = MONTH_KEY.exec(key);
  if (monthMatch) {
    const yearMonth = monthMatch[1]!;
    const cached = yearMonth === currentYearMonth()
      ? getCurrentMonthDigestFromCache(yearMonth, Date.now())
      : readMonthDigest(yearMonth);

    const prev = shiftYearMonth(yearMonth, -1);
    const nextRaw = shiftYearMonth(yearMonth, +1);
    const today = currentYearMonth();
    const nextYM = nextRaw > today ? null : nextRaw;
    const prevCached = !!readMonthDigest(prev);
    const nextCached = nextYM ? !!readMonthDigest(nextYM) : false;

    return (
      <div>
        <TopNav
          label={yearMonth}
          prev={{ key: `month-${prev}`, label: shortLabelMonth(prev), cached: prevCached }}
          next={nextYM ? { key: `month-${nextYM}`, label: shortLabelMonth(nextYM), cached: nextCached } : null}
        />
        <MonthDigestView initial={cached} yearMonth={yearMonth} aiEnabled={aiOn} />
      </div>
    );
  }

  notFound();
}

type NavTarget = { key: string; label: string; cached: boolean };

function TopNav({ label, prev, next }: { label: string; prev: NavTarget | null; next: NavTarget | null }) {
  return (
    <div className="no-print" style={topNavStyle}>
      <Link href="/insights" style={backBtnStyle}>
        <ArrowLeft size={12} /> Insights
      </Link>
      <span style={{ fontSize: 11, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)" }}>
        {label}
      </span>
      <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
        {prev && (
          <Link href={`/insights/${prev.key}`} style={navArrowStyle(prev.cached)} title={prev.cached ? `Saved digest · ${prev.label}` : `No saved digest · ${prev.label} (will prompt to Generate)`}>
            <ChevronLeft size={12} /> {prev.label}
          </Link>
        )}
        {next ? (
          <Link href={`/insights/${next.key}`} style={navArrowStyle(next.cached)} title={next.cached ? `Saved digest · ${next.label}` : `No saved digest · ${next.label} (will prompt to Generate)`}>
            {next.label} <ChevronRight size={12} />
          </Link>
        ) : (
          <span style={{ ...navArrowStyle(false), opacity: 0.4, cursor: "default" }} title="No next period — this would be in the future">
            — <ChevronRight size={12} />
          </span>
        )}
      </div>
    </div>
  );
}

function shiftMonday(monday: string, days: number): string {
  const d = new Date(`${monday}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shiftYearMonth(yearMonth: string, months: number): string {
  const [y, m] = yearMonth.split("-");
  const d = new Date(Number(y), Number(m) - 1 + months, 1);
  const ny = d.getFullYear();
  const nm = String(d.getMonth() + 1).padStart(2, "0");
  return `${ny}-${nm}`;
}

function shortLabelMonday(monday: string): string {
  const d = new Date(`${monday}T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function shortLabelMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

const topNavStyle: React.CSSProperties = {
  maxWidth: 980, margin: "0 auto", padding: "16px 44px 0",
  display: "flex", alignItems: "center", gap: 12,
};

const backBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px",
  border: "1px solid var(--af-border)", borderRadius: 8,
  background: "var(--af-surface)", color: "var(--af-text)",
  fontSize: 12, fontWeight: 500, textDecoration: "none",
};

function navArrowStyle(cached: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 4,
    padding: "5px 10px", borderRadius: 6,
    border: `1px solid ${cached ? "color-mix(in srgb, var(--af-accent) 28%, var(--af-border))" : "var(--af-border-subtle)"}`,
    background: cached ? "color-mix(in srgb, var(--af-accent) 6%, var(--af-surface))" : "var(--af-surface)",
    color: cached ? "var(--af-accent)" : "var(--af-text-secondary)",
    fontSize: 11, fontWeight: 500, fontFamily: "var(--font-mono)",
    textDecoration: "none",
  };
}
