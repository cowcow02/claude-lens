export type TrivialInput = { active_min: number; turn_count: number; tools_total: number };

/** Trivial threshold: ALL three conditions must hold. */
export function isTrivial(n: TrivialInput): boolean {
  return n.active_min < 1 && n.turn_count < 3 && n.tools_total === 0;
}
