import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cacheStats,
  clearCaches,
  invalidateFile,
  loadCalibrationEvents,
} from "../src/fs.js";

function writeJsonl(filePath: string, lines: object[]): void {
  writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

function assistantLine(id: string, ts: string, inputTokens: number) {
  return {
    type: "assistant",
    timestamp: ts,
    message: {
      id,
      model: "claude-sonnet-4-5-20250929",
      usage: { input_tokens: inputTokens, output_tokens: 0 },
    },
  };
}

describe("loadCalibrationEvents per-file cache", () => {
  let root: string;

  beforeEach(() => {
    clearCaches();
    root = mkdtempSync(path.join(os.tmpdir(), "fleetlens-cal-cache-"));
  });

  afterEach(() => {
    clearCaches();
    rmSync(root, { recursive: true, force: true });
  });

  it("populates the cache on miss and returns identical data on hit", async () => {
    const projectDir = path.join(root, "-Users-me-proj");
    mkdirSync(projectDir);
    const sessionFile = path.join(projectDir, "session-1.jsonl");
    writeJsonl(sessionFile, [
      assistantLine("msg_a", "2026-04-01T00:00:00.000Z", 1000),
      assistantLine("msg_b", "2026-04-01T00:01:00.000Z", 2000),
    ]);

    expect(cacheStats().calibrationEventsEntries).toBe(0);

    const first = await loadCalibrationEvents(root);
    expect(first).toHaveLength(2);
    expect(cacheStats().calibrationEventsEntries).toBe(1);

    const second = await loadCalibrationEvents(root);
    expect(second).toEqual(first);
    expect(cacheStats().calibrationEventsEntries).toBe(1);
  });

  it("aggregates events across multiple files and projects", async () => {
    const projA = path.join(root, "-Users-me-projA");
    const projB = path.join(root, "-Users-me-projB");
    mkdirSync(projA);
    mkdirSync(projB);
    writeJsonl(path.join(projA, "s1.jsonl"), [
      assistantLine("msg_a1", "2026-04-01T00:00:00.000Z", 1000),
    ]);
    writeJsonl(path.join(projA, "s2.jsonl"), [
      assistantLine("msg_a2", "2026-04-01T00:05:00.000Z", 1000),
    ]);
    writeJsonl(path.join(projB, "s3.jsonl"), [
      assistantLine("msg_b1", "2026-04-01T00:10:00.000Z", 1000),
    ]);

    const events = await loadCalibrationEvents(root);
    expect(events.map((e) => e.ts)).toEqual([
      "2026-04-01T00:00:00.000Z",
      "2026-04-01T00:05:00.000Z",
      "2026-04-01T00:10:00.000Z",
    ]);
    expect(cacheStats().calibrationEventsEntries).toBe(3);
  });

  it("returns updated content after invalidateFile when the file is modified", async () => {
    const projectDir = path.join(root, "-Users-me-proj");
    mkdirSync(projectDir);
    const sessionFile = path.join(projectDir, "session-1.jsonl");
    writeJsonl(sessionFile, [assistantLine("msg_a", "2026-04-01T00:00:00.000Z", 1000)]);
    const before = await loadCalibrationEvents(root);
    expect(before).toHaveLength(1);

    writeJsonl(sessionFile, [
      assistantLine("msg_a", "2026-04-01T00:00:00.000Z", 1000),
      assistantLine("msg_b", "2026-04-01T00:02:00.000Z", 5000),
    ]);
    invalidateFile(sessionFile);

    const after = await loadCalibrationEvents(root);
    expect(after).toHaveLength(2);
  });

  it("clearCaches() drops calibration entries", async () => {
    mkdirSync(path.join(root, "-Users-me-proj"));
    writeJsonl(path.join(root, "-Users-me-proj", "s.jsonl"), [
      assistantLine("msg_a", "2026-04-01T00:00:00.000Z", 1000),
    ]);
    await loadCalibrationEvents(root);
    expect(cacheStats().calibrationEventsEntries).toBe(1);

    clearCaches();
    expect(cacheStats().calibrationEventsEntries).toBe(0);
  });

  it("invalidateFile() drops only the entry for the specific path", async () => {
    const projectDir = path.join(root, "-Users-me-proj");
    mkdirSync(projectDir);
    const a = path.join(projectDir, "a.jsonl");
    const b = path.join(projectDir, "b.jsonl");
    writeJsonl(a, [assistantLine("msg_a", "2026-04-01T00:00:00.000Z", 1000)]);
    writeJsonl(b, [assistantLine("msg_b", "2026-04-01T00:01:00.000Z", 2000)]);
    await loadCalibrationEvents(root);
    expect(cacheStats().calibrationEventsEntries).toBe(2);

    invalidateFile(a);
    expect(cacheStats().calibrationEventsEntries).toBe(1);
  });
});
