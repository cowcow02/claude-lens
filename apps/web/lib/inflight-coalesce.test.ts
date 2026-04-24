import { describe, expect, it } from "vitest";
import { InflightCoalescer } from "./inflight-coalesce";

describe("InflightCoalescer", () => {
  it("second caller with same key awaits the first; worker runs once", async () => {
    const c = new InflightCoalescer<string, string>();
    let runs = 0;
    const worker = async () => { runs++; await new Promise(r => setTimeout(r, 10)); return "ok"; };

    const [a, b] = await Promise.all([
      c.run("k1", worker),
      c.run("k1", worker),
    ]);
    expect(a).toBe("ok");
    expect(b).toBe("ok");
    expect(runs).toBe(1);
  });

  it("different keys run independently", async () => {
    const c = new InflightCoalescer<string, string>();
    let runs = 0;
    const worker = async () => { runs++; return "ok"; };
    await Promise.all([c.run("k1", worker), c.run("k2", worker)]);
    expect(runs).toBe(2);
  });

  it("drops entry after resolution so subsequent same-key call re-runs", async () => {
    const c = new InflightCoalescer<string, string>();
    let runs = 0;
    const worker = async () => { runs++; return "ok"; };
    await c.run("k1", worker);
    await c.run("k1", worker);
    expect(runs).toBe(2);
  });

  it("drops entry after rejection and propagates the error", async () => {
    const c = new InflightCoalescer<string, string>();
    const failing = async (): Promise<string> => { throw new Error("boom"); };
    await expect(c.run("k1", failing)).rejects.toThrow("boom");
    const ok = await c.run("k1", async () => "ok");
    expect(ok).toBe("ok");
  });
});
