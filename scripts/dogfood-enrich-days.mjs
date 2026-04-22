#!/usr/bin/env node
// Dogfood script: enrich every pending Entry for the specified local_days,
// across ALL projects. Uses the same enrichEntry + writeEntry + appendSpend
// pipeline as the daemon queue — just without the 5-gate filtering, because
// we explicitly want complete coverage for these specific days.

import { listEntryKeys, readEntry, writeEntry } from "../packages/entries/dist/fs.js";
import { parseEntryKey } from "../packages/entries/dist/types.js";
import { enrichEntry } from "../packages/entries/dist/enrich.js";
import { appendSpend } from "../packages/entries/dist/budget.js";

const TARGET_DAYS = new Set(process.argv.slice(2));
if (TARGET_DAYS.size === 0) {
  console.error("usage: node dogfood-enrich-days.mjs <YYYY-MM-DD> [<YYYY-MM-DD> ...]");
  process.exit(1);
}

const targets = [];
for (const key of listEntryKeys()) {
  const parsed = parseEntryKey(key);
  if (!parsed) continue;
  if (!TARGET_DAYS.has(parsed.local_day)) continue;
  const e = readEntry(parsed.session_id, parsed.local_day);
  if (!e) continue;
  if (e.enrichment.status !== "pending") continue;
  targets.push(e);
}

console.error(`[dogfood] targets: ${targets.length} pending entries across ${TARGET_DAYS.size} day(s)`);
console.error(`[dogfood] running sequentially; est. ~${(targets.length * 24 / 60).toFixed(1)} min\n`);

let enriched = 0, errors = 0;
const startedAt = Date.now();

for (const entry of targets) {
  const label = `[${enriched + errors + 1}/${targets.length}] ${entry.session_id.slice(0, 8)}… ${entry.local_day} ${entry.project} (${entry.numbers.active_min}min)`;
  process.stderr.write(`→ ${label}\n`);
  try {
    const { entry: result, usage } = await enrichEntry(entry, { model: "sonnet" });
    writeEntry(result);
    if (result.enrichment.status === "done") {
      enriched++;
      appendSpend({
        ts: new Date().toISOString(),
        caller: "cli",
        model: result.enrichment.model ?? "sonnet",
        input_tokens: usage?.input_tokens ?? 0,
        output_tokens: usage?.output_tokens ?? 0,
        cost_usd: result.enrichment.cost_usd ?? 0,
        kind: "entry_enrich",
        ref: `${result.session_id}__${result.local_day}`,
      });
      process.stderr.write(`  ✓ ${result.enrichment.outcome}/${result.enrichment.claude_helpfulness} — ${result.enrichment.brief_summary.slice(0, 80)}…\n`);
    } else {
      errors++;
      process.stderr.write(`  ✗ error: ${result.enrichment.error?.slice(0, 120)}\n`);
    }
  } catch (err) {
    errors++;
    process.stderr.write(`  ✗ threw: ${err.message.slice(0, 120)}\n`);
  }
}

const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
console.error(`\n[dogfood] done in ${elapsedSec}s — enriched=${enriched} errors=${errors}`);
console.log(JSON.stringify({ enriched, errors, total: targets.length, elapsedSec }));
