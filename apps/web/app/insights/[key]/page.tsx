/**
 * Saved-report viewer. Deep-linkable, bookmarkable, server-rendered.
 *
 * /insights           → history + picker (client-state machine)
 * /insights/[key]     → this page — reads the saved JSON off disk
 * /insights/print/[key] → headless-Chrome target for PDF export
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { InsightReport } from "@/components/insight-report";
import { getSavedReport } from "@/lib/ai/saved-reports";

export const dynamic = "force-dynamic";

export default async function SavedInsightPage({
  params,
}: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const report = await getSavedReport(key);
  if (!report) notFound();

  return (
    <div>
      <div className="no-print" style={topNavStyle}>
        <Link href="/insights" style={backBtnStyle}>
          <ArrowLeft size={12} /> Reports
        </Link>
        <span style={{ fontSize: 11, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)" }}>
          saved · key: {key}
        </span>
      </div>
      <InsightReport data={report} savedKey={key} />
    </div>
  );
}

const topNavStyle: React.CSSProperties = {
  maxWidth: 980,
  margin: "0 auto",
  padding: "16px 44px 0",
  display: "flex",
  alignItems: "center",
  gap: 12,
};

const backBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 12px",
  border: "1px solid var(--af-border)",
  borderRadius: 8,
  background: "var(--af-surface)",
  color: "var(--af-text)",
  fontSize: 12,
  fontWeight: 500,
  textDecoration: "none",
};
