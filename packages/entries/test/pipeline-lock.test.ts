import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writeInteractiveLock, removeInteractiveLock, interactiveLockFresh,
  __setInteractiveLockPathForTest,
} from "../src/pipeline-lock.js";

describe("pipeline-lock", () => {
  let p: string;
  beforeEach(() => {
    const d = mkdtempSync(join(tmpdir(), "lock-"));
    p = join(d, "lock");
    __setInteractiveLockPathForTest(p);
  });

  it("write creates the file with current PID", () => {
    writeInteractiveLock();
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, "utf8").trim()).toBe(String(process.pid));
  });

  it("remove deletes the file", () => {
    writeInteractiveLock();
    removeInteractiveLock();
    expect(existsSync(p)).toBe(false);
  });

  it("remove is a no-op when file absent", () => {
    expect(() => removeInteractiveLock()).not.toThrow();
  });

  it("interactiveLockFresh returns true for fresh lock of current pid", () => {
    writeInteractiveLock();
    expect(interactiveLockFresh(Date.now())).toBe(true);
  });

  it("interactiveLockFresh returns false for stale lock (mtime > 60s)", () => {
    writeInteractiveLock();
    expect(interactiveLockFresh(Date.now() + 90_000)).toBe(false);
  });

  it("interactiveLockFresh returns false when PID not alive", () => {
    writeFileSync(p, "99999999");
    expect(interactiveLockFresh(Date.now())).toBe(false);
  });

  it("interactiveLockFresh returns false when file missing", () => {
    expect(interactiveLockFresh(Date.now())).toBe(false);
  });
});
