/**
 * Date-range utilities used by both server components (for filtering)
 * and the client segmented control (for rendering). Lives in lib/
 * rather than alongside the client component so server components can
 * import it without the "use client" boundary poisoning.
 */

export type RangeKey = "7d" | "30d" | "90d" | "all";

/** Parse a search-param value into a RangeKey (default: "all"). */
export function parseRange(value: string | string[] | undefined): RangeKey {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === "7d" || v === "30d" || v === "90d" || v === "all") return v;
  return "all";
}

/** Return the cutoff ms for a given range, or undefined for "all". */
export function cutoffMs(range: RangeKey, now = Date.now()): number | undefined {
  if (range === "all") return undefined;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  return now - days * 24 * 60 * 60 * 1000;
}
