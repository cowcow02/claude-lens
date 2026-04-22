export type UserInputSource = "human" | "teammate" | "skill_load" | "slash_command";

const TEAMMATE_RE = /^<teammate-message\b/;
const SKILL_LOAD_RE = /^Base directory for this skill:/;
const SLASH_COMMAND_RE = /^<command-name>|^<local-command-stdout>/;

export function classifyUserInputSource(text: string): UserInputSource {
  if (!text) return "human";
  if (TEAMMATE_RE.test(text)) return "teammate";
  if (SKILL_LOAD_RE.test(text)) return "skill_load";
  if (SLASH_COMMAND_RE.test(text)) return "slash_command";
  return "human";
}

const HAPPY_RE = /\b(?:yay|yaay|yass|woohoo|nice|great|love(?:ly)?|perfect|amazing|awesome)\s*!|!!!/gi;
const SATISFIED_RE = /\b(?:thanks|thank you|looks good|lgtm|works|that works|all good|sounds good)\b/gi;
const DISSATISFIED_RE = /\b(?:that'?s (?:not|wrong)|try again|no, (?:that|this)|not quite|incorrect)\b/gi;
const FRUSTRATED_RE = /\b(?:broken|stop|why (?:did|are|would) you|give up|ugh|argh|wtf)\b/gi;

export type SatisfactionCounts = {
  happy: number;
  satisfied: number;
  dissatisfied: number;
  frustrated: number;
};

export function countSatisfactionSignals(text: string): SatisfactionCounts {
  if (!text) return { happy: 0, satisfied: 0, dissatisfied: 0, frustrated: 0 };
  return {
    happy: (text.match(HAPPY_RE) ?? []).length,
    satisfied: (text.match(SATISFIED_RE) ?? []).length,
    dissatisfied: (text.match(DISSATISFIED_RE) ?? []).length,
    frustrated: (text.match(FRUSTRATED_RE) ?? []).length,
  };
}

/**
 * Extract up to 5 explicit user asks.
 * Matches "can you X", "please X", "let's X", "I need X".
 * Returns cleaned X strings ≤ 200 chars.
 */
const INSTRUCTION_RE = /\b(?:can you|please|let's|let us|i need|could you|would you)\s+([^.?!\n]{5,200})/gi;

export function extractUserInstructions(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = INSTRUCTION_RE.exec(text)) !== null) {
    const phrase = m[1]!.trim().replace(/\s+/g, " ");
    const lc = phrase.toLowerCase();
    if (seen.has(lc)) continue;
    seen.add(lc);
    out.push(phrase);
    if (out.length >= 5) break;
  }
  return out;
}
