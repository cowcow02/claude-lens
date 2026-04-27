import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { readSettings, readWeekDigest, readMonthDigest } from "@claude-lens/entries/node";
import { WeekDigestView } from "@/components/week-digest-view";
import { MonthDigestView } from "@/components/month-digest-view";

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
    const cached = readWeekDigest(monday);
    return (
      <div>
        <TopNav label={`Week of ${monday}`} />
        <WeekDigestView initial={cached} monday={monday} aiEnabled={aiOn} />
      </div>
    );
  }

  const monthMatch = MONTH_KEY.exec(key);
  if (monthMatch) {
    const yearMonth = monthMatch[1]!;
    const cached = readMonthDigest(yearMonth);
    return (
      <div>
        <TopNav label={yearMonth} />
        <MonthDigestView initial={cached} yearMonth={yearMonth} aiEnabled={aiOn} />
      </div>
    );
  }

  notFound();
}

function TopNav({ label }: { label: string }) {
  return (
    <div className="no-print" style={topNavStyle}>
      <Link href="/insights" style={backBtnStyle}>
        <ArrowLeft size={12} /> Insights
      </Link>
      <span style={{ fontSize: 11, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)" }}>
        {label}
      </span>
    </div>
  );
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
