import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEnrichmentQueue } from "../src/queue.js";
import { writeEntry, readEntry, __setEntriesDirForTest } from "../src/fs.js";
import { __setSpendPathForTest } from "../src/budget.js";
import type { CallLLM } from "../src/enrich.js";
import type { Entry } from "../src/types.js";
import { pendingEnrichment } from "../src/types.js";

// AiFeaturesSettings shape — inline to keep this test independent of settings.ts
// helper functions (added in Task 9). The queue only reads these five fields.
type QueueSettings = {
  enabled: boolean;
  apiKey: string;
  model: string;
  allowedProjects: string[];
  monthlyBudgetUsd: number | null;
};

function mkEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    version: 2,
    session_id: `s-${Math.random().toString(36).slice(2, 10)}`,
    local_day: "2026-04-20",
    project: "/Users/test/foo",
    start_iso: "2026-04-20T09:00:00.000Z",
    end_iso: "2026-04-19T10:30:00.000Z",
    numbers: {
      active_min: 10, turn_count: 5, tools_total: 10, subagent_calls: 0,
      skill_calls: 0, task_ops: 0, interrupts: 0, tool_errors: 0,
      consec_same_tool_max: 0, exit_plan_calls: 0, prs: 0, commits: 0,
      pushes: 0, tokens_total: 1000,
    },
    flags: [],
    primary_model: "claude-sonnet-4-6",
    model_mix: {},
    first_user: "do a thing",
    final_agent: "done",
    pr_titles: [],
    top_tools: [],
    skills: {},
    subagents: [],
    satisfaction_signals: { happy: 0, satisfied: 0, dissatisfied: 0, frustrated: 0 },
    user_input_sources: { human: 1, teammate: 0, skill_load: 0, slash_command: 0 },
    enrichment: pendingEnrichment(),
    generated_at: "2026-04-20T10:30:00.000Z",
    source_jsonl: "/fake/path.jsonl",
    source_checkpoint: { byte_offset: 0, last_event_ts: null },
    ...overrides,
  };
}

describe("runEnrichmentQueue", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "enrich-queue-"));
    mkdirSync(join(tmp, "entries"), { recursive: true });
    __setEntriesDirForTest(join(tmp, "entries"));
    __setSpendPathForTest(join(tmp, "spend.jsonl"));
  });

  const baseSettings: QueueSettings = {
    enabled: true,
    apiKey: "sk-fake",
    model: "claude-sonnet-4-6",
    allowedProjects: ["/Users/test/foo"],
    monthlyBudgetUsd: null,
  };

  it("returns skipped:disabled when ai_features.enabled is false", async () => {
    const r = await runEnrichmentQueue({ ...baseSettings, enabled: false });
    expect(r).toEqual({ skipped: "disabled" });
  });

  it("returns skipped:no_api_key when apiKey is blank", async () => {
    const r = await runEnrichmentQueue({ ...baseSettings, apiKey: "" });
    expect(r).toEqual({ skipped: "no_api_key" });
  });

  it("returns skipped:no_allowed_projects when allowedProjects is empty", async () => {
    const r = await runEnrichmentQueue({ ...baseSettings, allowedProjects: [] });
    expect(r).toEqual({ skipped: "no_allowed_projects" });
  });

  it("enriches a pending Entry and writes the result + a spend record with real token counts", async () => {
    const entry = mkEntry({
      session_id: "s-enrich-1",
      local_day: "2026-04-20",
      project: "/Users/test/foo",
      end_iso: "2026-04-19T10:30:00.000Z",
    });
    writeEntry(entry);

    const callLLM: CallLLM = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        brief_summary: "You did the thing.",
        underlying_goal: "ship",
        friction_detail: null,
        user_instructions: [],
        goal_categories: { build: 10 },
        outcome: "shipped",
        claude_helpfulness: "helpful",
      }),
      input_tokens: 500, output_tokens: 100, model: "claude-sonnet-4-6",
    });

    const result = await runEnrichmentQueue(baseSettings, { callLLM });
    expect(result).toMatchObject({ enriched: 1, errors: 0 });

    const updated = readEntry("s-enrich-1", "2026-04-20")!;
    expect(updated.enrichment.status).toBe("done");
    expect(updated.enrichment.brief_summary).toBe("You did the thing.");

    const spend = readFileSync(join(tmp, "spend.jsonl"), "utf8").trim().split("\n");
    expect(spend).toHaveLength(1);
    const rec = JSON.parse(spend[0]!);
    expect(rec.input_tokens).toBe(500);
    expect(rec.output_tokens).toBe(100);
    expect(rec.kind).toBe("entry_enrich");
    expect(rec.caller).toBe("daemon");
  });

  it("skips today's Entries", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const entry = mkEntry({ local_day: today, project: "/Users/test/foo" });
    writeEntry(entry);

    const callLLM: CallLLM = vi.fn();
    const r = await runEnrichmentQueue(baseSettings, { callLLM });
    expect("enriched" in r ? r.enriched : 0).toBe(0);
    expect(callLLM).not.toHaveBeenCalled();
  });

  it("skips Entries whose end_iso is within the last 30 min", async () => {
    const now = Date.now();
    const entry = mkEntry({
      local_day: "2026-04-20",
      project: "/Users/test/foo",
      end_iso: new Date(now - 15 * 60 * 1000).toISOString(),
    });
    writeEntry(entry);
    const callLLM: CallLLM = vi.fn();
    const r = await runEnrichmentQueue(baseSettings, { callLLM });
    expect("enriched" in r ? r.enriched : 0).toBe(0);
    expect(callLLM).not.toHaveBeenCalled();
  });

  it("skips Entries whose project is not in allowedProjects", async () => {
    const entry = mkEntry({ local_day: "2026-04-20", project: "/Users/other/bar" });
    writeEntry(entry);
    const callLLM: CallLLM = vi.fn();
    const r = await runEnrichmentQueue(baseSettings, { callLLM });
    expect("enriched" in r ? r.enriched : 0).toBe(0);
    expect(callLLM).not.toHaveBeenCalled();
  });

  it("halts on budget cap mid-run; second Entry stays pending", async () => {
    for (let i = 0; i < 2; i++) {
      writeEntry(mkEntry({
        session_id: `budget-${i}`,
        local_day: "2026-04-20",
        project: "/Users/test/foo",
        end_iso: "2026-04-19T10:30:00.000Z",
      }));
    }
    const callLLM: CallLLM = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        brief_summary: "ok", underlying_goal: "ok", friction_detail: null,
        user_instructions: [], goal_categories: {}, outcome: "shipped",
        claude_helpfulness: "helpful",
      }),
      input_tokens: 100_000, output_tokens: 10_000, model: "claude-sonnet-4-6",
    });
    const r = await runEnrichmentQueue(
      { ...baseSettings, monthlyBudgetUsd: 0.001 },
      { callLLM },
    );
    expect(callLLM).toHaveBeenCalledTimes(1);
    expect("enriched" in r ? r.enriched : 0).toBe(1);

    const e0 = readEntry("budget-0", "2026-04-20")!;
    const e1 = readEntry("budget-1", "2026-04-20")!;
    const remaining = [e0, e1].filter(e => e.enrichment.status === "pending");
    expect(remaining).toHaveLength(1);
  });

  it("skips Entries with retry_count >= 3 (frozen)", async () => {
    const entry = mkEntry({
      session_id: "frozen-1",
      local_day: "2026-04-20",
      project: "/Users/test/foo",
    });
    entry.enrichment.status = "error";
    entry.enrichment.retry_count = 3;
    writeEntry(entry);

    const callLLM: CallLLM = vi.fn();
    const r = await runEnrichmentQueue(baseSettings, { callLLM });
    expect(callLLM).not.toHaveBeenCalled();
    expect("enriched" in r ? r.enriched : 0).toBe(0);
  });
});
