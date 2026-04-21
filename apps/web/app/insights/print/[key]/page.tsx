/**
 * Print-mode rendering target for `/api/insights/pdf/[key]`.
 *
 * Server-renders the saved report with the sidebar and floating widgets
 * hidden, light theme forced, and print-optimised spacing. Chrome headless
 * points at this URL when generating the PDF.
 */
import { notFound } from "next/navigation";
import { InsightReport } from "@/components/insight-report";
import { getSavedReport } from "@/lib/ai/saved-reports";

export const dynamic = "force-dynamic";

export default async function PrintInsightPage({
  params,
}: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const report = await getSavedReport(key);
  if (!report) notFound();

  return (
    <div data-theme="light" style={{ background: "white", minHeight: "100vh" }}>
      <style>{`
        /* Hide app chrome when this page is embedded under the main layout */
        aside, [data-sidebar], .af-sidebar,
        [data-live-refresher], .af-live-widget,
        nav[aria-label="Main"], header[data-app-header] { display: none !important; }
        body { background: white !important; margin: 0 !important; padding: 0 !important; }
        main { padding: 0 !important; margin: 0 !important; width: 100% !important; }
        .no-print { display: none !important; }
        .report-root {
          max-width: 780px !important;
          margin: 0 auto !important;
          padding: 40px 44px 56px !important;
          color: var(--af-text) !important;
        }
        .report-root section { page-break-inside: avoid; }
        @page { size: letter; margin: 0; }
      `}</style>
      <InsightReport data={report} />
    </div>
  );
}
