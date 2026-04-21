import { describe, it, expect } from "vitest";
import { parseTranscript } from "../src/parser.js";
import { buildCapsule } from "../src/capsule.js";
import type { SessionDetail } from "../src/types.js";

const USER_TS = "2026-04-17T10:00:00Z";
const A1_TS = "2026-04-17T10:00:05Z";
const A2_TS = "2026-04-17T10:00:10Z";

const userMsg = (text: string, ts: string, uuid = "u-" + ts) => ({
  type: "user",
  uuid,
  parentUuid: null,
  timestamp: ts,
  sessionId: "sess-1",
  cwd: "/Users/me/Repo/test",
  message: { role: "user", content: text },
});

const assistantText = (text: string, ts: string, messageId = "m-" + ts) => ({
  type: "assistant",
  uuid: "a-" + ts,
  timestamp: ts,
  sessionId: "sess-1",
  message: {
    id: messageId,
    role: "assistant",
    model: "claude-opus-4-7",
    content: [{ type: "text", text }],
    usage: { input_tokens: 50, output_tokens: 20, cache_read_input_tokens: 500, cache_creation_input_tokens: 100 },
    stop_reason: "end_turn",
  },
});

const assistantTool = (name: string, input: object, ts: string) => ({
  type: "assistant",
  uuid: "a-" + ts,
  timestamp: ts,
  sessionId: "sess-1",
  message: {
    id: "m-tool-" + ts,
    role: "assistant",
    model: "claude-opus-4-7",
    content: [{ type: "tool_use", id: "tu-" + ts, name, input }],
    usage: { input_tokens: 5, output_tokens: 0, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 },
    stop_reason: "tool_use",
  },
});

function makeDetail(rawLines: unknown[]): SessionDetail {
  const { events } = parseTranscript(rawLines);
  return {
    id: "sess-1",
    filePath: "/x/sess-1.jsonl",
    projectName: "/Users/me/Repo/test",
    projectDir: "-Users-me-Repo-test",
    sessionId: "sess-1",
    firstTimestamp: USER_TS,
    lastTimestamp: A2_TS,
    durationMs: 10_000,
    eventCount: events.length,
    model: "claude-opus-4-7",
    cwd: "/Users/me/Repo/test",
    totalUsage: { input: 50, output: 20, cacheRead: 500, cacheWrite: 100 },
    status: "idle",
    events,
  };
}

describe("buildCapsule", () => {
  it("extracts first user + final agent as intent material", () => {
    const detail = makeDetail([
      userMsg("Help me refactor the parser", USER_TS),
      assistantText("Sure — I'll start by reading the types file.", A1_TS),
      assistantText("Done. Parser is now 30 lines shorter.", A2_TS),
    ]);
    const cap = buildCapsule(detail, { compact: true });
    expect(cap.first_user).toMatch(/^Help me refactor the parser/);
    expect(cap.final_agent).toMatch(/30 lines shorter/);
  });

  it("classifies outcome as shipped when a gh pr create runs", () => {
    const detail = makeDetail([
      userMsg("Ship it", USER_TS),
      assistantTool("Bash", { command: "gh pr create --title \"feat: add insights\" --body ..." }, A1_TS),
      assistantText("Opened PR.", A2_TS),
    ]);
    const cap = buildCapsule(detail, { compact: true });
    expect(cap.outcome).toBe("shipped");
    expect(cap.pr_titles).toEqual(["feat: add insights"]);
  });

  it("captures skill invocations by name", () => {
    const detail = makeDetail([
      userMsg("Write this skill", USER_TS),
      assistantTool("Skill", { skill: "superpowers:writing-skills" }, A1_TS),
      assistantText("Skill loaded.", A2_TS),
    ]);
    const cap = buildCapsule(detail, { compact: true });
    expect(cap.skills).toEqual({ "superpowers:writing-skills": 1 });
  });

  it("captures subagent dispatches with their prompts and models", () => {
    const detail = makeDetail([
      userMsg("Parallelise this", USER_TS),
      assistantTool("Agent", {
        description: "Find the bug",
        subagent_type: "Explore",
        prompt: "Search src/ for the regex handling X...",
        model: "sonnet",
      }, A1_TS),
      assistantText("Dispatched.", A2_TS),
    ]);
    const cap = buildCapsule(detail, { compact: true });
    expect(cap.subagents).toHaveLength(1);
    expect(cap.subagents![0]).toMatchObject({
      type: "Explore",
      model: "sonnet",
      description: "Find the bug",
    });
    expect(cap.subagents![0]!.prompt_preview).toContain("Search src/");
    expect(cap.numbers.subagent_calls).toBe(1);
  });

  it("counts commits and pushes from Bash tool_use only — not from content strings", () => {
    const detail = makeDetail([
      userMsg("Run the release", USER_TS),
      assistantText("I'll git commit and git push — just narrating, not running.", A1_TS),
      assistantTool("Bash", { command: "git commit -m 'release'" }, A2_TS),
      assistantTool("Bash", { command: "git push origin master" }, A2_TS),
    ]);
    const cap = buildCapsule(detail, { compact: true });
    expect(cap.numbers.commits).toBe(1);
    expect(cap.numbers.pushes).toBe(1);
  });

  it("classifies trivial when active time is under 2 minutes with < 3 turns", () => {
    const detail = makeDetail([
      userMsg("hi", USER_TS),
      assistantText("hi there", A1_TS),
    ]);
    const cap = buildCapsule(detail, { compact: true });
    expect(cap.outcome).toBe("trivial");
  });

  it("raises loop_suspected when the same tool fires ≥ 8 times in a row", () => {
    const rawLines: unknown[] = [userMsg("grep everywhere", USER_TS)];
    for (let i = 0; i < 10; i++) {
      rawLines.push(assistantTool("Grep", { pattern: `foo${i}` }, `2026-04-17T10:00:${String(i).padStart(2, "0")}Z`));
    }
    const detail = makeDetail(rawLines);
    const cap = buildCapsule(detail, { compact: true });
    expect(cap.flags).toContain("loop_suspected");
    expect(cap.numbers.consec_same_tool_max).toBeGreaterThanOrEqual(8);
  });

  it("produces top-N turns array in full mode, omits it in compact mode", () => {
    const detail = makeDetail([
      userMsg("do thing", USER_TS),
      assistantText("done", A1_TS),
    ]);
    const compact = buildCapsule(detail, { compact: true });
    const full = buildCapsule(detail, { compact: false });
    expect(compact.turns).toBeUndefined();
    expect(full.turns).toBeDefined();
  });
});
