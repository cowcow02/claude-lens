import { describe, it, expect } from "vitest";
import {
  classifyUserInputSource,
  countSatisfactionSignals,
  extractUserInstructions,
} from "../src/signals.js";

describe("classifyUserInputSource", () => {
  it("flags <teammate-message> as teammate", () => {
    expect(classifyUserInputSource('<teammate-message teammate_id="team-lead">…')).toBe("teammate");
  });
  it("flags 'Base directory for this skill:' as skill_load", () => {
    expect(classifyUserInputSource("Base directory for this skill: /Users/x\nSkill body…")).toBe("skill_load");
  });
  it("flags <command-name> as slash_command", () => {
    expect(classifyUserInputSource("<command-name>/commit</command-name> body")).toBe("slash_command");
  });
  it("defaults to human for ordinary prose", () => {
    expect(classifyUserInputSource("can you fix the bug in foo.ts")).toBe("human");
  });
  it("handles empty string as human (degenerate)", () => {
    expect(classifyUserInputSource("")).toBe("human");
  });
});

describe("countSatisfactionSignals", () => {
  it("counts happy markers", () => {
    const c = countSatisfactionSignals("Yay! perfect! amazing");
    expect(c.happy).toBe(2);  // "Yay!" and "perfect!" (amazing not in set)
  });
  it("counts frustrated markers", () => {
    const c = countSatisfactionSignals("this is broken. stop. why did you do this");
    expect(c.frustrated).toBeGreaterThanOrEqual(2);
  });
  it("returns zeros for neutral text", () => {
    expect(countSatisfactionSignals("add a new function that returns 5")).toEqual({
      happy: 0, satisfied: 0, dissatisfied: 0, frustrated: 0,
    });
  });
});

describe("extractUserInstructions", () => {
  it("pulls 'can you…' asks", () => {
    const out = extractUserInstructions("can you rename foo to bar. also please run the tests.");
    expect(out).toContain("rename foo to bar");
    expect(out.some(s => s.includes("run the tests"))).toBe(true);
  });
  it("returns empty array for non-request text", () => {
    expect(extractUserInstructions("thanks, that worked")).toEqual([]);
  });
  it("caps at 5 instructions", () => {
    const text = "please a. please b. please c. please d. please e. please f. please g.";
    expect(extractUserInstructions(text).length).toBeLessThanOrEqual(5);
  });
});
