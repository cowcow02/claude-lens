import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SessionMeta } from "@claude-lens/parser";
import { buildDailyRollup, buildIngestPayload, pushToTeamServer } from "../../src/team/push.js";
import type { TeamConfig } from "../../src/team/config.js";

function makeSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: "sess_1",
    filePath: "/tmp/sess.jsonl",
    projectName: "/tmp/project",
    projectDir: "tmp-project",
    sessionId: "sess_1",
    eventCount: 10,
    totalUsage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5 },
    status: "idle",
    airTimeMs: 60_000,
    toolCallCount: 5,
    turnCount: 3,
    ...overrides,
  };
}

const CONFIG: TeamConfig = {
  serverUrl: "https://team.example.com",
  memberId: "mem_abc",
  bearerToken: "tok_secret",
  teamSlug: "acme",
  pairedAt: "2026-01-01T00:00:00.000Z",
};

describe("buildDailyRollup", () => {
  it("returns all zeros for empty sessions", () => {
    const rollup = buildDailyRollup([], "2026-04-16");
    expect(rollup).toEqual({
      day: "2026-04-16",
      agentTimeMs: 0,
      sessions: 0,
      toolCalls: 0,
      turns: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
  });

  it("sums values across multiple sessions", () => {
    const s1 = makeSession({ airTimeMs: 60_000, toolCallCount: 5, turnCount: 3, totalUsage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5 } });
    const s2 = makeSession({ id: "sess_2", airTimeMs: 30_000, toolCallCount: 2, turnCount: 1, totalUsage: { input: 200, output: 80, cacheRead: 20, cacheWrite: 0 } });
    const rollup = buildDailyRollup([s1, s2], "2026-04-16");
    expect(rollup).toEqual({
      day: "2026-04-16",
      agentTimeMs: 90_000,
      sessions: 2,
      toolCalls: 7,
      turns: 4,
      tokens: { input: 300, output: 130, cacheRead: 30, cacheWrite: 5 },
    });
  });

  it("handles missing optional fields (undefined airTimeMs, toolCallCount, turnCount)", () => {
    const s = makeSession({ airTimeMs: undefined, toolCallCount: undefined, turnCount: undefined });
    const rollup = buildDailyRollup([s], "2026-04-16");
    expect(rollup.agentTimeMs).toBe(0);
    expect(rollup.toolCalls).toBe(0);
    expect(rollup.turns).toBe(0);
  });
});

describe("buildIngestPayload", () => {
  it("wraps rollup with UUID ingestId and ISO observedAt", () => {
    const rollup = buildDailyRollup([], "2026-04-16");
    const before = Date.now();
    const payload = buildIngestPayload(rollup);
    const after = Date.now();

    expect(payload.dailyRollup).toEqual(rollup);
    // UUID v4 format
    expect(payload.ingestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // observedAt is valid ISO within test window
    const ts = Date.parse(payload.observedAt);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("generates a unique ingestId on each call", () => {
    const rollup = buildDailyRollup([], "2026-04-16");
    const a = buildIngestPayload(rollup);
    const b = buildIngestPayload(rollup);
    expect(a.ingestId).not.toBe(b.ingestId);
  });
});

describe("pushToTeamServer", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls fetch with correct URL, headers, and body", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ received: true }),
    } as Response);

    const rollup = buildDailyRollup([], "2026-04-16");
    const payload = buildIngestPayload(rollup);
    const result = await pushToTeamServer(CONFIG, payload);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://team.example.com/api/ingest/metrics");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer tok_secret",
    });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(payload);

    expect(result).toEqual({ ok: true, status: 200, body: { received: true } });
  });

  it("returns ok:false on server error", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "unauthorized" }),
    } as Response);

    const payload = buildIngestPayload(buildDailyRollup([], "2026-04-16"));
    const result = await pushToTeamServer(CONFIG, payload);
    expect(result).toEqual({ ok: false, status: 401, body: { error: "unauthorized" } });
  });

  it("returns null body when response is not JSON", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => { throw new Error("not json"); },
    } as unknown as Response);

    const payload = buildIngestPayload(buildDailyRollup([], "2026-04-16"));
    const result = await pushToTeamServer(CONFIG, payload);
    expect(result).toEqual({ ok: false, status: 500, body: null });
  });
});
