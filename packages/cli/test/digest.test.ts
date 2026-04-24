import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

// vitest runs with cwd = packages/cli
const CLI = join(process.cwd(), "dist", "index.js");

beforeAll(() => {
  if (!existsSync(CLI)) {
    execSync("node build.mjs", { stdio: "inherit", cwd: process.cwd() });
  }
}, 60_000);

function mkFixtureEntry(dir: string, sessionId: string, localDay: string, activeMin = 60): void {
  const entry = {
    version: 2, session_id: sessionId, local_day: localDay,
    project: "/x", start_iso: `${localDay}T10:00:00Z`, end_iso: `${localDay}T11:00:00Z`,
    numbers: {
      active_min: activeMin, turn_count: 10, tools_total: 20, subagent_calls: 0,
      skill_calls: 0, task_ops: 0, interrupts: 0, tool_errors: 0,
      consec_same_tool_max: 0, exit_plan_calls: 0, prs: 0, commits: 0, pushes: 0, tokens_total: 0,
    },
    flags: [], primary_model: null, model_mix: {}, first_user: "", final_agent: "",
    pr_titles: [], top_tools: [], skills: {}, subagents: [],
    satisfaction_signals: { happy: 0, satisfied: 0, dissatisfied: 0, frustrated: 0 },
    user_input_sources: { human: 0, teammate: 0, skill_load: 0, slash_command: 0 },
    enrichment: {
      status: "pending", generated_at: null, model: null, cost_usd: null, error: null,
      brief_summary: null, underlying_goal: null, friction_detail: null, user_instructions: [],
      outcome: null, claude_helpfulness: null, goal_categories: {}, retry_count: 0,
    },
    generated_at: `${localDay}T11:00:00Z`, source_jsonl: "/",
    source_checkpoint: { byte_offset: 0, last_event_ts: null },
  };
  writeFileSync(join(dir, `${sessionId}__${localDay}.json`), JSON.stringify(entry));
}

describe("fleetlens digest day", () => {
  let entriesDir: string;
  beforeEach(() => {
    entriesDir = mkdtempSync(join(tmpdir(), "digest-cli-"));
  });

  it("--date X --json prints a valid DayDigest JSON", () => {
    mkFixtureEntry(entriesDir, "s1", "2026-04-23", 60);
    const env = { ...process.env, CCLENS_ENTRIES_DIR: entriesDir, CCLENS_AI_DISABLED: "1" };
    const out = execSync(`node "${CLI}" digest day --date 2026-04-23 --json`, { env, encoding: "utf8" });
    const parsed = JSON.parse(out);
    expect(parsed.scope).toBe("day");
    expect(parsed.key).toBe("2026-04-23");
    expect(parsed.agent_min).toBe(60);
  });

  it("exits non-zero on invalid date", () => {
    mkFixtureEntry(entriesDir, "s1", "2026-04-23", 60);
    const env = { ...process.env, CCLENS_ENTRIES_DIR: entriesDir, CCLENS_AI_DISABLED: "1" };
    expect(() =>
      execSync(`node "${CLI}" digest day --date notadate --json`, { env, encoding: "utf8" })
    ).toThrow();
  });

  it("prints pretty-format by default", () => {
    mkFixtureEntry(entriesDir, "s1", "2026-04-23", 60);
    const env = { ...process.env, CCLENS_ENTRIES_DIR: entriesDir, CCLENS_AI_DISABLED: "1" };
    const out = execSync(`node "${CLI}" digest day --date 2026-04-23`, { env, encoding: "utf8" });
    expect(out).toContain("2026-04-23");
    expect(out).toContain("60m");
  });
});
