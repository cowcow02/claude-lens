/**
 * Renders a saved insight report to PDF via headless Chrome and streams
 * the bytes back. The actual HTML is served by
 * `/insights/print/[key]/page.tsx`; this route just drives the browser.
 */
import { getSavedReport } from "@/lib/ai/saved-reports";
import { renderPdf, findChrome } from "@/lib/ai/chrome-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ key: string }> },
) {
  const { key } = await ctx.params;
  if (!/^[a-z0-9-]+$/i.test(key)) {
    return new Response("invalid key", { status: 400 });
  }
  const report = await getSavedReport(key);
  if (!report) return new Response("report not found", { status: 404 });

  if (!findChrome()) {
    return new Response(
      "No Chrome/Chromium binary found. Install Chrome or set the CHROME_BIN env var.",
      { status: 503 },
    );
  }

  const origin = new URL(req.url).origin;
  const printUrl = `${origin}/insights/print/${encodeURIComponent(key)}`;

  try {
    const bytes = await renderPdf(printUrl, key);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${key}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return new Response(`PDF render failed: ${(err as Error).message}`, { status: 500 });
  }
}
