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
    <div data-theme="light" data-print-mode="true" style={{ background: "white" }}>
      <style>{`
        /* Neutralise the root-layout viewport lock so content paginates freely. */
        html, body {
          height: auto !important;
          min-height: 0 !important;
          overflow: visible !important;
          background: white !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        body > div[style*="height: 100vh"],
        body > div[style*="height:100vh"] {
          display: block !important;
          height: auto !important;
          min-height: 0 !important;
        }
        main {
          flex: none !important;
          padding: 0 !important;
          margin: 0 !important;
          width: 100% !important;
          min-height: 0 !important;
          overflow: visible !important;
        }

        /* Hide everything that isn't the report itself. */
        aside, [data-sidebar], .af-sidebar,
        [data-live-refresher], .af-live-widget,
        nav[aria-label="Main"], header[data-app-header] { display: none !important; }
        .no-print { display: none !important; }

        /* Report layout tuned for letter paper. */
        .report-root {
          max-width: none !important;
          margin: 0 !important;
          padding: 36px 48px 48px !important;
          color: var(--af-text) !important;
        }
        .report-root section { page-break-inside: auto; }
        .report-root section > header,
        .report-root [role="heading"],
        .report-root h1, .report-root h2, .report-root h3 {
          page-break-after: avoid;
          break-after: avoid;
        }
        @page { size: letter; margin: 0.4in; }
      `}</style>
      <InsightReport data={report} />
    </div>
  );
}
