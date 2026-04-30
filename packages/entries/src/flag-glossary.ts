/**
 * Internal flag tokens emitted by the deterministic Entry builder
 * (`packages/entries/src/build.ts`) translated into user-facing language.
 *
 * The flags are heuristics over JSONL events, named for brevity in code. The
 * user has no way to know what they mean unless we surface the definition.
 * This module is the canonical mapping between the raw token, the
 * plain-English label we put in reports, and the exact threshold that
 * triggered detection. Renderers + prompt builders import this so we never
 * leak `loop_suspected` style vocabulary into surfaces meant for humans.
 *
 * Keep in sync with the flag-emission logic in build.ts.
 */

export type FlagDef = {
  /** Raw flag token as written into Entry.flags[]. */
  token: string;
  /** User-facing short label — what we say in headlines / chips. */
  label: string;
  /** One-line definition with the literal threshold inline. */
  description: string;
  /** "tone" hint for renderers — what color family to use. */
  tone: "warn" | "info" | "ok";
};

export const FLAG_GLOSSARY: Record<string, FlagDef> = {
  loop_suspected: {
    token: "loop_suspected",
    label: "consecutive-tool run",
    description: "The same tool was called 8 or more times in a row without interleaving — heuristic for a possible tool loop, but legitimate Read/Grep marathons also trigger it.",
    tone: "warn",
  },
  long_autonomous: {
    token: "long_autonomous",
    label: "long autonomous turn",
    description: "A single turn ran 20 minutes or longer without any user interruption.",
    tone: "info",
  },
  orchestrated: {
    token: "orchestrated",
    label: "subagent-orchestrated",
    description: "3 or more turns dispatched a subagent via the Task tool.",
    tone: "info",
  },
  fast_ship: {
    token: "fast_ship",
    label: "fast ship",
    description: "A PR shipped in under 5 minutes of agent time.",
    tone: "ok",
  },
  plan_used: {
    token: "plan_used",
    label: "plan mode",
    description: "Plan mode was entered at least once during this slice.",
    tone: "info",
  },
  interrupt_heavy: {
    token: "interrupt_heavy",
    label: "frequent interrupts",
    description: "You hit Esc or cancelled 3 or more times.",
    tone: "warn",
  },
  high_errors: {
    token: "high_errors",
    label: "high tool-error rate",
    description: "20 or more tool calls returned errors.",
    tone: "warn",
  },
};

/** Lookup helper. Falls back to a synthetic def for unknown tokens (forward-compat). */
export function flagDef(token: string): FlagDef {
  return FLAG_GLOSSARY[token] ?? {
    token,
    label: token.replace(/_/g, " "),
    description: `Internal flag: ${token}.`,
    tone: "info",
  };
}

/** Render-ready glossary excerpt for the week-prompt builder. */
export function flagGlossaryForPrompt(): Array<{ token: string; label: string; description: string }> {
  return Object.values(FLAG_GLOSSARY).map(({ token, label, description }) => ({ token, label, description }));
}
