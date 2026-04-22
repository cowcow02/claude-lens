import { listEntriesWithStatus, writeEntry } from "./fs.js";
import { enrichEntry, type CallLLM } from "./enrich.js";
import { appendSpend, monthToDateSpend } from "./budget.js";
import type { AiFeaturesSettings } from "./settings.js";
import type { Entry } from "./types.js";

export type EnrichmentResult =
  | { skipped: "disabled" | "no_allowed_projects" | "budget_cap_reached" }
  | { enriched: number; errors: number; skipped: number };

export type EnrichmentQueueOptions = {
  callLLM?: CallLLM;
  /** Override the "now" reference for the today-skip and 30-min-settled checks (tests). */
  now?: () => number;
};

const THIRTY_MIN_MS = 30 * 60 * 1000;
const MAX_RETRY_COUNT = 3;

function toLocalDay(ms: number): string {
  // Local-day in the reader's timezone, matching how buildEntries slices days.
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function runEnrichmentQueue(
  settings: AiFeaturesSettings,
  opts: EnrichmentQueueOptions = {},
): Promise<EnrichmentResult> {
  if (!settings.enabled) return { skipped: "disabled" };
  if (settings.allowedProjects.length === 0) return { skipped: "no_allowed_projects" };

  const budget = settings.monthlyBudgetUsd ?? Infinity;
  if (monthToDateSpend() >= budget) return { skipped: "budget_cap_reached" };

  const now = opts.now ?? (() => Date.now());

  const queue = listEntriesWithStatus(["pending", "error"])
    .filter(e => (e.enrichment.retry_count ?? 0) < MAX_RETRY_COUNT);

  const allowed = new Set(settings.allowedProjects);
  const todayLocal = toLocalDay(now());
  let enriched = 0, errors = 0, skipped = 0;

  for (const entry of queue) {
    if (entry.local_day === todayLocal) { skipped++; continue; }
    const endMs = Date.parse(entry.end_iso);
    if (!Number.isNaN(endMs) && now() - endMs < THIRTY_MIN_MS) { skipped++; continue; }
    if (!allowed.has(entry.project)) { skipped++; continue; }

    // Re-read spend each iteration — no in-memory cache. A long backfill that
    // crosses the cap mid-run halts on the right Entry.
    if (monthToDateSpend() >= budget) break;

    try {
      const { entry: result, usage } = await enrichEntry(entry, {
        model: settings.model,
        callLLM: opts.callLLM,
      });
      writeEntry(result);
      if (result.enrichment.status === "done") {
        enriched++;
        appendSpend({
          ts: new Date().toISOString(),
          caller: "daemon",
          model: result.enrichment.model ?? settings.model,
          input_tokens: usage?.input_tokens ?? 0,
          output_tokens: usage?.output_tokens ?? 0,
          cost_usd: result.enrichment.cost_usd ?? 0,
          kind: "entry_enrich",
          ref: `${result.session_id}__${result.local_day}`,
        });
      } else {
        errors++;
      }
    } catch (err) {
      // enrichEntry catches LLM/parse/schema failures internally and returns
      // status="error". This branch only fires for framework-level failures
      // (disk write, JSON stringification, object-literal programming errors).
      errors++;
      const failed: Entry = {
        ...entry,
        enrichment: {
          ...entry.enrichment,
          status: "error",
          retry_count: (entry.enrichment.retry_count ?? 0) + 1,
          error: (err as Error).message,
          generated_at: new Date().toISOString(),
        },
      };
      writeEntry(failed);
    }
  }

  return { enriched, errors, skipped };
}
