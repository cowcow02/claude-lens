import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendSpend,
  monthToDateSpend,
  __setSpendPathForTest,
  type SpendRecord,
} from "../src/budget.js";

function rec(partial: Partial<SpendRecord> = {}): SpendRecord {
  return {
    ts: "2026-04-22T10:00:00.000Z",
    caller: "daemon",
    model: "claude-sonnet-4-6",
    input_tokens: 1000,
    output_tokens: 200,
    cost_usd: 0.01,
    kind: "entry_enrich",
    ref: "test__2026-04-22",
    ...partial,
  };
}

describe("budget", () => {
  let spendPath: string;
  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), "budget-"));
    spendPath = join(tmp, "llm-spend.jsonl");
    __setSpendPathForTest(spendPath);
  });

  it("appendSpend creates the file on first write", () => {
    expect(existsSync(spendPath)).toBe(false);
    appendSpend(rec());
    expect(existsSync(spendPath)).toBe(true);
    const lines = readFileSync(spendPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ cost_usd: 0.01 });
  });

  it("appendSpend appends JSONL — one line per call", () => {
    appendSpend(rec({ cost_usd: 0.01 }));
    appendSpend(rec({ cost_usd: 0.02 }));
    appendSpend(rec({ cost_usd: 0.03 }));
    const lines = readFileSync(spendPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.map(l => JSON.parse(l).cost_usd)).toEqual([0.01, 0.02, 0.03]);
  });

  it("monthToDateSpend sums records in the current month", () => {
    const now = new Date("2026-04-22T12:00:00.000Z");
    appendSpend(rec({ ts: "2026-04-01T00:00:00.000Z", cost_usd: 0.10 }));
    appendSpend(rec({ ts: "2026-04-15T00:00:00.000Z", cost_usd: 0.20 }));
    appendSpend(rec({ ts: "2026-04-22T00:00:00.000Z", cost_usd: 0.05 }));
    expect(monthToDateSpend(now)).toBeCloseTo(0.35, 6);
  });

  it("monthToDateSpend excludes prior-month records", () => {
    const now = new Date("2026-04-22T12:00:00.000Z");
    appendSpend(rec({ ts: "2026-03-28T00:00:00.000Z", cost_usd: 100 }));
    appendSpend(rec({ ts: "2026-04-01T00:00:00.000Z", cost_usd: 0.10 }));
    expect(monthToDateSpend(now)).toBeCloseTo(0.10, 6);
  });

  it("monthToDateSpend returns 0 for a nonexistent spend file", () => {
    expect(monthToDateSpend(new Date())).toBe(0);
  });

  it("monthToDateSpend skips malformed lines silently", () => {
    appendSpend(rec({ cost_usd: 0.05 }));
    appendFileSync(spendPath, "not-json\n");
    appendSpend(rec({ cost_usd: 0.07 }));
    expect(monthToDateSpend(new Date("2026-04-22T12:00:00.000Z"))).toBeCloseTo(0.12, 6);
  });
});
