/**
 * Persistence for generated insight reports.
 *
 * Reports are keyed by their window start date + range_type:
 *   week-2026-04-13.json        — week of Apr 13 – Apr 19
 *   4weeks-2026-03-23.json      — 4-week rollup Mar 23 – Apr 19
 *
 * Pruning is lazy — we don't delete; this is ~2 KB/report so a year of
 * weekly reports is ~100 KB.
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ReportData } from "@/components/insight-report";

const DIR = join(homedir(), ".cclens", "insights");

export type SavedReportMeta = {
  key: string;
  period_label: string;
  period_sublabel: string;
  range_type: ReportData["range_type"];
  archetype_label: string;
  archetype_icon: string;
  saved_at: string;
  sessions_used: number;
  prs: number;
};

type SavedFile = { saved_at: string; report: ReportData };

export function keyForRange(range_type: ReportData["range_type"], startIso: string): string {
  const yyyymmdd = startIso.slice(0, 10);
  return `${range_type}-${yyyymmdd}`;
}

export async function saveReport(key: string, report: ReportData): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  const payload: SavedFile = { saved_at: new Date().toISOString(), report };
  await fs.writeFile(join(DIR, `${key}.json`), JSON.stringify(payload, null, 2));
}

export async function listSavedReports(): Promise<SavedReportMeta[]> {
  try {
    const files = await fs.readdir(DIR);
    const out: SavedReportMeta[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(join(DIR, f), "utf8");
        const parsed = JSON.parse(raw) as SavedFile;
        const r = parsed.report;
        out.push({
          key: f.replace(/\.json$/, ""),
          period_label: r.period_label,
          period_sublabel: r.period_sublabel,
          range_type: r.range_type,
          archetype_label: r.archetype.label,
          archetype_icon: r.archetype.icon,
          saved_at: parsed.saved_at,
          sessions_used: r.meta.sessions_used,
          prs: r.shipped.length,
        });
      } catch { /* skip corrupt */ }
    }
    // Newest first (keys sort lexicographically by start date since YYYY-MM-DD)
    out.sort((a, b) => b.key.localeCompare(a.key));
    return out;
  } catch {
    return [];
  }
}

export async function getSavedReport(key: string): Promise<ReportData | null> {
  if (!/^[a-z0-9-]+$/i.test(key)) return null; // no path traversal
  try {
    const raw = await fs.readFile(join(DIR, `${key}.json`), "utf8");
    const parsed = JSON.parse(raw) as SavedFile;
    return parsed.report;
  } catch {
    return null;
  }
}
