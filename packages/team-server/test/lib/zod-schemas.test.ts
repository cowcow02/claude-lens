import { describe, it, expect } from "vitest";
import {
  IngestPayload,
  ClaimPayload,
  InvitePayload,
  JoinPayload,
  UsageSnapshotSchema,
} from "../../src/lib/zod-schemas.js";

const validIngest = {
  ingestId: "abc123",
  observedAt: "2024-01-15T10:00:00.000Z",
  dailyRollup: {
    day: "2024-01-15",
    agentTimeMs: 3600000,
    sessions: 5,
    toolCalls: 42,
    turns: 10,
    tokens: {
      input: 1000,
      output: 500,
      cacheRead: 200,
      cacheWrite: 100,
    },
  },
};

describe("IngestPayload", () => {
  it("passes with valid data", () => {
    expect(() => IngestPayload.parse(validIngest)).not.toThrow();
  });

  it("fails when required fields are missing", () => {
    expect(() => IngestPayload.parse({ ingestId: "x" })).toThrow();
  });

  it("preserves unknown top-level fields (passthrough)", () => {
    const result = IngestPayload.parse({ ...validIngest, futureField: "v2" });
    expect((result as any).futureField).toBe("v2");
  });

  it("preserves unknown fields inside dailyRollup (passthrough)", () => {
    const input = {
      ...validIngest,
      dailyRollup: { ...validIngest.dailyRollup, newMetric: 99 },
    };
    const result = IngestPayload.parse(input);
    expect((result.dailyRollup as any).newMetric).toBe(99);
  });

  it("preserves unknown fields inside tokens (passthrough)", () => {
    const input = {
      ...validIngest,
      dailyRollup: {
        ...validIngest.dailyRollup,
        tokens: { ...validIngest.dailyRollup.tokens, cacheWriteInference: 50 },
      },
    };
    const result = IngestPayload.parse(input);
    expect((result.dailyRollup.tokens as any).cacheWriteInference).toBe(50);
  });
});

describe("ClaimPayload", () => {
  it("passes with valid data", () => {
    expect(() =>
      ClaimPayload.parse({ bootstrapToken: "tok", teamName: "Acme" })
    ).not.toThrow();
  });

  it("fails with empty teamName", () => {
    expect(() =>
      ClaimPayload.parse({ bootstrapToken: "tok", teamName: "" })
    ).toThrow();
  });

  it("fails with teamName > 100 chars", () => {
    expect(() =>
      ClaimPayload.parse({ bootstrapToken: "tok", teamName: "a".repeat(101) })
    ).toThrow();
  });
});

describe("InvitePayload", () => {
  it("defaults expiresInDays to 7", () => {
    const result = InvitePayload.parse({});
    expect(result.expiresInDays).toBe(7);
  });

  it("rejects expiresInDays > 30", () => {
    expect(() => InvitePayload.parse({ expiresInDays: 31 })).toThrow();
  });
});

describe("JoinPayload", () => {
  it("passes with valid data", () => {
    expect(() =>
      JoinPayload.parse({ inviteToken: "tok123" })
    ).not.toThrow();
  });
});

describe("UsageSnapshotSchema", () => {
  const validSnapshot = {
    capturedAt: "2026-04-22T10:30:00.000Z",
    fiveHour: { utilization: 23.7, resetsAt: "2026-04-22T14:00:00.000Z" },
    sevenDay: { utilization: 47.2, resetsAt: "2026-04-26T00:00:00.000Z" },
    sevenDayOpus: null,
    sevenDaySonnet: null,
    sevenDayOauthApps: null,
    sevenDayCowork: null,
    extraUsage: null,
  };

  it("passes with the minimal-non-null shape", () => {
    expect(() => UsageSnapshotSchema.parse(validSnapshot)).not.toThrow();
  });

  it("accepts null utilization on a window", () => {
    expect(() =>
      UsageSnapshotSchema.parse({
        ...validSnapshot,
        fiveHour: { utilization: null, resetsAt: null },
      }),
    ).not.toThrow();
  });

  it("preserves unknown fields on extraUsage (passthrough)", () => {
    const result = UsageSnapshotSchema.parse({
      ...validSnapshot,
      extraUsage: {
        isEnabled: true,
        monthlyLimitUsd: 50,
        usedCreditsUsd: 10,
        utilization: 20,
        futureField: "v2",
      },
    });
    expect((result.extraUsage as any).futureField).toBe("v2");
  });

  it("rejects when fiveHour window is missing", () => {
    const { fiveHour: _omit, ...rest } = validSnapshot;
    expect(() => UsageSnapshotSchema.parse(rest)).toThrow();
  });

  it("IngestPayload accepts an optional usageSnapshot", () => {
    const withSnapshot = { ...validIngest, usageSnapshot: validSnapshot };
    expect(() => IngestPayload.parse(withSnapshot)).not.toThrow();
  });

  // Anthropic's /api/oauth/usage returns timestamps with explicit `+00:00`
  // offsets, not the `Z` shorthand. The daemon forwards them verbatim, so
  // the schema must accept both. Without `{ offset: true }` zod rejects
  // every real-world payload — see PR #23 review for the regression.
  it("accepts offset-form timestamps from Anthropic's API", () => {
    expect(() =>
      UsageSnapshotSchema.parse({
        ...validSnapshot,
        capturedAt: "2026-04-29T02:58:41.717+00:00",
        fiveHour: {
          utilization: 19,
          resetsAt: "2026-04-29T07:10:00.207984+00:00",
        },
        sevenDay: {
          utilization: 18,
          resetsAt: "2026-05-04T12:00:00.208003+00:00",
        },
      }),
    ).not.toThrow();
  });
});
