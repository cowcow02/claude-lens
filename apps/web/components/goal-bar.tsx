"use client";

/** Stacked horizontal bar showing time spent across goal-categories.
 *  Used by both day and week digests. */

export const GOAL_COLORS: Record<string, string> = {
  build: "var(--af-accent)",
  plan: "#9f7aea",
  debug: "#ed8936",
  review: "#4299e1",
  refactor: "#38b2ac",
  test: "#48bb78",
  release: "#ed64a6",
  research: "#a0aec0",
  steer: "#f6ad55",
  meta: "#718096",
  warmup_minimal: "#cbd5e0",
};

export function GoalBar({
  goals, total, height = 12,
}: {
  goals: Array<{ category: string; minutes: number }>;
  total: number;
  height?: number;
}) {
  if (total === 0 || goals.length === 0) {
    return <p style={{ fontSize: 12, color: "var(--af-text-tertiary)", margin: 0 }}>No goal data.</p>;
  }
  return (
    <div>
      <div style={{ display: "flex", gap: 2, height, borderRadius: 3, overflow: "hidden" }}>
        {goals.map(g => {
          const pct = (g.minutes / total) * 100;
          return (
            <div
              key={g.category}
              style={{
                width: `${pct}%`,
                background: GOAL_COLORS[g.category] ?? "#888",
              }}
              title={`${g.category}: ${Math.round(g.minutes)}m (${pct.toFixed(0)}%)`}
            />
          );
        })}
      </div>
      <div style={{
        display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap",
        fontSize: 11, color: "var(--af-text-tertiary)",
      }}>
        {goals.map(g => (
          <span key={g.category} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{
              width: 8, height: 8, borderRadius: 2,
              background: GOAL_COLORS[g.category] ?? "#888",
            }} />
            {g.category}  {Math.round(g.minutes)}m
          </span>
        ))}
      </div>
    </div>
  );
}
