import { describe, it, expect, beforeEach } from "vitest";
import { addClient, broadcastEvent } from "../../src/lib/sse.js";

// Helper to create a mock ReadableStreamDefaultController that tracks enqueued data
function makeMockController() {
  const chunks: Uint8Array[] = [];
  let closed = false;
  const controller = {
    enqueue(chunk: Uint8Array) {
      if (closed) throw new Error("Stream closed");
      chunks.push(chunk);
    },
    get chunks() { return chunks; },
    get text() { return chunks.map((c) => new TextDecoder().decode(c)).join(""); },
    close() { closed = true; },
    setClosed() { closed = true; },
  };
  return controller as unknown as ReadableStreamDefaultController & {
    chunks: Uint8Array[];
    text: string;
    setClosed: () => void;
  };
}

describe("addClient / broadcastEvent", () => {
  it("addClient returns a cleanup function that removes the client", () => {
    const ctrl = makeMockController();
    const cleanup = addClient(ctrl, "team-a");

    broadcastEvent("team-a", "test-event", { x: 1 });
    expect(ctrl.chunks).toHaveLength(1);

    cleanup();
    broadcastEvent("team-a", "test-event", { x: 2 });
    // still just 1 after cleanup
    expect(ctrl.chunks).toHaveLength(1);
  });

  it("broadcastEvent only reaches clients on the same teamId", () => {
    const ctrlA = makeMockController();
    const ctrlB = makeMockController();
    const cleanA = addClient(ctrlA, "team-x");
    const cleanB = addClient(ctrlB, "team-y");

    broadcastEvent("team-x", "ping", {});

    expect(ctrlA.chunks).toHaveLength(1);
    expect(ctrlB.chunks).toHaveLength(0);

    cleanA();
    cleanB();
  });

  it("broadcast message contains the event name and JSON data", () => {
    const ctrl = makeMockController();
    const cleanup = addClient(ctrl, "team-z");

    broadcastEvent("team-z", "roster-updated", { membershipId: "m1" });
    const text = ctrl.text;
    expect(text).toContain("event: roster-updated");
    expect(text).toContain('"membershipId":"m1"');

    cleanup();
  });

  it("dead controller (throws on enqueue) is auto-removed on broadcast", () => {
    const ctrl = makeMockController();
    const cleanup = addClient(ctrl, "team-dead");

    // Kill the controller so enqueue throws
    ctrl.setClosed();

    // Should not throw; dead clients are silently removed
    expect(() => broadcastEvent("team-dead", "evt", {})).not.toThrow();

    cleanup();
  });

  it("multiple clients on the same team all receive the broadcast", () => {
    const c1 = makeMockController();
    const c2 = makeMockController();
    const cl1 = addClient(c1, "team-multi");
    const cl2 = addClient(c2, "team-multi");

    broadcastEvent("team-multi", "update", { n: 42 });
    expect(c1.chunks).toHaveLength(1);
    expect(c2.chunks).toHaveLength(1);

    cl1();
    cl2();
  });
});
