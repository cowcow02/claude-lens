#!/usr/bin/env node
// Companion viewer for dogfood-enrich-days.mjs — renders every enriched Entry
// for the specified local_days, grouped by day + project.

import { listEntryKeys, readEntry } from "../packages/entries/dist/fs.js";
import { parseEntryKey } from "../packages/entries/dist/types.js";

const TARGET_DAYS = new Set(process.argv.slice(2));
if (TARGET_DAYS.size === 0) {
  console.error("usage: node dogfood-show-days.mjs <YYYY-MM-DD> [<YYYY-MM-DD> ...]");
  process.exit(1);
}

const byDay = new Map();
for (const key of listEntryKeys()) {
  const parsed = parseEntryKey(key);
  if (!parsed) continue;
  if (!TARGET_DAYS.has(parsed.local_day)) continue;
  const e = readEntry(parsed.session_id, parsed.local_day);
  if (!e) continue;
  if (!byDay.has(e.local_day)) byDay.set(e.local_day, []);
  byDay.get(e.local_day).push(e);
}

for (const [day, entries] of [...byDay.entries()].sort()) {
  entries.sort((a, b) => a.project.localeCompare(b.project) || a.start_iso.localeCompare(b.start_iso));
  const done = entries.filter(e => e.enrichment.status === "done");
  const trivial = entries.filter(e => e.enrichment.status === "skipped_trivial");
  const other = entries.filter(e => !["done", "skipped_trivial"].includes(e.enrichment.status));

  const totalActive = entries.reduce((s, e) => s + e.numbers.active_min, 0);
  const totalPrs = entries.reduce((s, e) => s + e.pr_titles.length, 0);
  const totalCommits = entries.reduce((s, e) => s + e.numbers.commits, 0);
  const projects = new Set(entries.map(e => e.project));
  const goalMinutes = {};
  for (const e of done) {
    for (const [g, m] of Object.entries(e.enrichment.goal_categories || {})) {
      goalMinutes[g] = (goalMinutes[g] ?? 0) + m;
    }
  }
  const outcomes = {};
  for (const e of done) outcomes[e.enrichment.outcome] = (outcomes[e.enrichment.outcome] ?? 0) + 1;

  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log(`DAY ${day} — ${entries.length} entries across ${projects.size} project(s)`);
  console.log(`  total active: ${totalActive.toFixed(1)}min | commits ${totalCommits} | PRs ${totalPrs}`);
  console.log(`  status: ${done.length} done, ${trivial.length} trivial, ${other.length} other`);
  if (Object.keys(goalMinutes).length > 0) {
    const total = Object.values(goalMinutes).reduce((a, b) => a + b, 0);
    const sorted = Object.entries(goalMinutes).sort((a, b) => b[1] - a[1]);
    console.log(`  goal mix (min):  ${sorted.map(([g, m]) => `${g}:${m.toFixed(0)}`).join("  ")}`);
    console.log(`  → share:         ${sorted.map(([g, m]) => `${g}:${(100 * m / total).toFixed(0)}%`).join("  ")}`);
  }
  if (Object.keys(outcomes).length > 0) {
    console.log(`  outcomes:        ${Object.entries(outcomes).map(([k, v]) => `${k}:${v}`).join("  ")}`);
  }
  console.log("═══════════════════════════════════════════════════════════════════════");

  for (const e of entries) {
    const prj = e.project.replace("/Users/cowcow02/Repo/", "").replace("/Users/cowcow02", "~");
    console.log();
    console.log(`┌─ ${e.session_id.slice(0, 8)}  ${prj}  ${e.numbers.active_min}min`);
    if (e.flags.length > 0) console.log(`│  flags: ${e.flags.join(", ")}`);
    console.log(`│  PRs ${e.pr_titles.length} · commits ${e.numbers.commits} · pushes ${e.numbers.pushes} · tools ${e.numbers.tools_total} · turns ${e.numbers.turn_count}`);
    if (e.pr_titles.length > 0) {
      console.log(`│  PR titles: ${e.pr_titles.slice(0, 2).map(t => `"${t.slice(0, 80)}"`).join(", ")}`);
    }
    if (e.enrichment.status === "done") {
      console.log(`│  → outcome: ${e.enrichment.outcome} · helpfulness: ${e.enrichment.claude_helpfulness}`);
      console.log(`│  → brief: ${e.enrichment.brief_summary}`);
      console.log(`│  → goal:  ${e.enrichment.underlying_goal}`);
      const goals = Object.entries(e.enrichment.goal_categories || {}).map(([g, m]) => `${g}:${m}`);
      if (goals.length > 0) console.log(`│  → time:  ${goals.join(" · ")}min`);
      if (e.enrichment.friction_detail) console.log(`│  → friction: ${e.enrichment.friction_detail}`);
    } else if (e.enrichment.status === "skipped_trivial") {
      console.log(`│  [skipped_trivial — <1min of real work, no enrichment needed]`);
    } else if (e.enrichment.status === "error") {
      console.log(`│  [ERROR: ${e.enrichment.error}]`);
    } else {
      console.log(`│  [${e.enrichment.status}]`);
    }
  }
  console.log();
}
