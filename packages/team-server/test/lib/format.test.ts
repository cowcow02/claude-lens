import { describe, it, expect } from "vitest";
import { formatAgentTime, formatTokens, timeAgo } from "../../src/lib/format.js";

describe("formatAgentTime", () => {
  it("shows 0m for zero ms", () => {
    expect(formatAgentTime(0)).toBe("0m");
  });

  it("shows only minutes when under 1 hour", () => {
    expect(formatAgentTime(35 * 60000)).toBe("35m");
  });

  it("shows hours and minutes when over 1 hour", () => {
    expect(formatAgentTime(90 * 60000)).toBe("1h 30m");
  });

  it("shows hours and 0m when exactly on the hour", () => {
    expect(formatAgentTime(2 * 3600000)).toBe("2h 0m");
  });

  it("shows large hour count", () => {
    expect(formatAgentTime(100 * 3600000 + 45 * 60000)).toBe("100h 45m");
  });

  it("does not show hours for 59m", () => {
    expect(formatAgentTime(59 * 60000)).toBe("59m");
  });
});

describe("formatTokens", () => {
  it("returns plain number for < 1000", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("formats thousands with k suffix", () => {
    expect(formatTokens(1000)).toBe("1k");
    expect(formatTokens(1500)).toBe("2k");
    expect(formatTokens(999_999)).toBe("1000k");
  });

  it("formats millions with M suffix", () => {
    expect(formatTokens(1_000_000)).toBe("1.0M");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });

  it("formats billions with B suffix", () => {
    expect(formatTokens(1_000_000_000)).toBe("1.0B");
    expect(formatTokens(3_700_000_000)).toBe("3.7B");
  });
});

describe("timeAgo", () => {
  it("returns 'Never' for null", () => {
    expect(timeAgo(null)).toBe("Never");
  });

  it("returns 'Just now' for < 1 minute ago", () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    expect(timeAgo(recent)).toBe("Just now");
  });

  it("returns minutes for < 1 hour ago", () => {
    const ago = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(timeAgo(ago)).toBe("5m ago");
  });

  it("returns hours for < 24 hours ago", () => {
    const ago = new Date(Date.now() - 3 * 3600_000).toISOString();
    expect(timeAgo(ago)).toBe("3h ago");
  });

  it("returns days for >= 24 hours ago", () => {
    const ago = new Date(Date.now() - 2 * 24 * 3600_000).toISOString();
    expect(timeAgo(ago)).toBe("2d ago");
  });

  it("returns '1m ago' for exactly 1 minute", () => {
    const ago = new Date(Date.now() - 60_000).toISOString();
    expect(timeAgo(ago)).toBe("1m ago");
  });
});
