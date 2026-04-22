#!/usr/bin/env node
/**
 * V1 insights regression guard.
 *
 * Ensures Phase 1a doesn't accidentally change V1 /insights output. Runs a
 * fixed fixture through buildCapsule + buildPeriodBundle, hashes the result,
 * and compares to a checked-in expected hash.
 *
 * On first run (if expected.sha256 is absent), writes the hash and exits 0.
 * On subsequent runs, hash mismatch exits 1 with a diff dump.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, "fixtures/v1-insights-regression/fixture.jsonl");
const EXPECTED_HASH_PATH = resolve(__dirname, "fixtures/v1-insights-regression/expected.sha256");

const { parseTranscript } = await import("../packages/parser/dist/parser.js");
const { buildCapsule } = await import("../packages/parser/dist/capsule.js");
const { buildPeriodBundle } = await import("../packages/parser/dist/aggregate.js");

const rawLines = readFileSync(FIXTURE, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const { meta, events } = parseTranscript(rawLines);
const sessionDetail = {
  ...meta,
  id: "v1-regression-session",
  filePath: FIXTURE,
  projectDir: "fixture",
  projectName: meta.cwd ?? "/fixture/project",
  events,
};

const capsule = buildCapsule(sessionDetail, { compact: true });
const bundle = buildPeriodBundle([capsule], {
  period: {
    start: new Date("2026-04-22T00:00:00Z"),
    end: new Date("2026-04-22T23:59:59Z"),
    range_type: "custom",
  },
  trivial_dropped: 0,
  sessions_total: 1,
});

// Hash — stringify as-is; there are no volatile fields in buildCapsule's
// output (no timestamps other than those derived from events themselves).
const json = JSON.stringify({ capsule, bundle }, null, 2);
const actual = createHash("sha256").update(json).digest("hex");

if (!existsSync(EXPECTED_HASH_PATH)) {
  writeFileSync(EXPECTED_HASH_PATH, actual + "\n");
  console.log(`wrote initial hash: ${actual}`);
  process.exit(0);
}

const expected = readFileSync(EXPECTED_HASH_PATH, "utf8").trim();
if (actual !== expected) {
  console.error(`V1 insights output changed!`);
  console.error(`  expected: ${expected}`);
  console.error(`  actual:   ${actual}`);
  // Dump the full payload for debugging
  const dumpPath = `${EXPECTED_HASH_PATH}.actual.json`;
  writeFileSync(dumpPath, json);
  console.error(`(payload dumped to ${dumpPath})`);
  console.error(``);
  console.error(`If this change is intentional (you modified buildCapsule or buildPeriodBundle),`);
  console.error(`delete ${EXPECTED_HASH_PATH} and re-run to regenerate the expected hash.`);
  process.exit(1);
}

console.log("V1 insights output unchanged ✓");
