import { listEntriesForDay, writeEntry } from "./fs.js";
import {
  readDayDigest, writeDayDigest,
  getTodayDigestFromCache, setTodayDigestInCache,
} from "./digest-fs.js";
import { enrichEntry, type CallLLM } from "./enrich.js";
import { generateDayDigest, buildDeterministicDigest } from "./digest-day.js";
import { appendSpend, monthToDateSpend } from "./budget.js";
import { writeInteractiveLock, removeInteractiveLock } from "./pipeline-lock.js";
import type { AiFeaturesSettings } from "./settings.js";
import type { DayDigest, Entry, EntryEnrichmentStatus } from "./types.js";

export type PipelineEvent =
  | { type: "status"; phase: "enrich" | "synth" | "persist"; text: string }
  | { type: "entry"; session_id: string; index: number; total: number; status: EntryEnrichmentStatus; cost_usd: number | null }
  | { type: "digest"; digest: DayDigest }
  | { type: "saved"; path: string }
  | { type: "error"; message: string };

export type PipelineOptions = {
  settings: AiFeaturesSettings;
  force?: boolean;
  callLLM?: CallLLM;
  now?: () => number;
  /** The current local day in server TZ; if `date === todayLocalDay`, skip disk persistence. */
  todayLocalDay: string;
};

const THIRTY_MIN_MS = 30 * 60 * 1000;
const MAX_RETRY_COUNT = 3;

export async function* runDayDigestPipeline(
  date: string,
  opts: PipelineOptions,
): AsyncGenerator<PipelineEvent, void, void> {
  const now = opts.now ?? (() => Date.now());
  const isToday = date === opts.todayLocalDay;
  const aiOn = opts.settings.enabled;

  // Short-circuit: past day, cached, !force → single digest event
  if (!isToday && !opts.force) {
    const cached = readDayDigest(date);
    if (cached) { yield { type: "digest", digest: cached }; return; }
  }

  // Short-circuit: today, cached in-memory TTL, !force → single digest event
  if (isToday && !opts.force) {
    const cached = getTodayDigestFromCache(date, now());
    if (cached) { yield { type: "digest", digest: cached }; return; }
  }

  const entries = listEntriesForDay(date) as Entry[];
  if (entries.length === 0) {
    yield { type: "error", message: `no entries for date ${date}` };
    return;
  }

  if (aiOn) writeInteractiveLock();
  try {
    // Stage 1: enrich
    if (aiOn) {
      const pending = entries.filter(e => {
        if (e.enrichment.status !== "pending" && e.enrichment.status !== "error") return false;
        if ((e.enrichment.retry_count ?? 0) >= MAX_RETRY_COUNT) return false;
        if (e.local_day === opts.todayLocalDay) return false;
        const endMs = Date.parse(e.end_iso);
        if (!Number.isNaN(endMs) && now() - endMs < THIRTY_MIN_MS) return false;
        return true;
      });

      if (pending.length > 0) {
        yield { type: "status", phase: "enrich", text: `Enriching ${pending.length} entries for ${date}` };
        const budget = opts.settings.monthlyBudgetUsd ?? Infinity;
        let idx = 0;
        for (const entry of pending) {
          idx++;
          if (monthToDateSpend() >= budget) {
            yield { type: "status", phase: "enrich", text: `budget cap reached — stopping enrichment` };
            break;
          }
          const { entry: result, usage } = await enrichEntry(entry, {
            model: opts.settings.model, callLLM: opts.callLLM,
          });
          writeEntry(result);
          if (result.enrichment.status === "done") {
            appendSpend({
              ts: new Date().toISOString(), caller: "web",
              model: result.enrichment.model ?? opts.settings.model,
              input_tokens: usage?.input_tokens ?? 0,
              output_tokens: usage?.output_tokens ?? 0,
              cost_usd: result.enrichment.cost_usd ?? 0,
              kind: "entry_enrich",
              ref: `${result.session_id}__${result.local_day}`,
            });
          }
          yield {
            type: "entry", session_id: result.session_id,
            index: idx, total: pending.length,
            status: result.enrichment.status, cost_usd: result.enrichment.cost_usd,
          };
        }
      }
    }

    // Reload entries (may have updated enrichment)
    const fresh = listEntriesForDay(date) as Entry[];

    // Stage 2: synthesize
    let digest: DayDigest;
    if (aiOn) {
      yield { type: "status", phase: "synth", text: "Synthesizing day narrative" };
      const r = await generateDayDigest(date, fresh, {
        model: opts.settings.model, callLLM: opts.callLLM,
      });
      digest = r.digest;
      if (r.usage) {
        appendSpend({
          ts: new Date().toISOString(), caller: "web",
          model: digest.model ?? opts.settings.model,
          input_tokens: r.usage.input_tokens,
          output_tokens: r.usage.output_tokens,
          cost_usd: digest.cost_usd ?? 0,
          kind: "day_digest", ref: date,
        });
      }
    } else {
      digest = buildDeterministicDigest(date, fresh);
    }

    // Stage 3: persist
    if (!isToday) {
      writeDayDigest(digest);
      yield { type: "saved", path: `~/.cclens/digests/day/${date}.json` };
    } else {
      setTodayDigestInCache(date, digest, now());
    }

    yield { type: "digest", digest };
  } finally {
    if (aiOn) removeInteractiveLock();
  }
}
