import type { DayHelpfulness } from "@claude-lens/entries";

const LEVELS: Record<NonNullable<DayHelpfulness>, { height: string; color: string; label: string }> = {
  essential:  { height: "100%", color: "#48bb78", label: "Essential"  },
  helpful:    { height: "75%",  color: "#4299e1", label: "Helpful"    },
  neutral:    { height: "50%",  color: "#a0aec0", label: "Neutral"    },
  unhelpful:  { height: "25%",  color: "#f56565", label: "Unhelpful"  },
};

export function HelpfulnessSparkline({
  days,
}: {
  days: Array<{ date: string; helpfulness: DayHelpfulness; cached: boolean }>;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 36 }}>
        {days.map((d) => {
          const level = d.helpfulness ? LEVELS[d.helpfulness] : null;
          return (
            <div
              key={d.date}
              title={
                level
                  ? `${d.date}: Claude ${level.label.toLowerCase()}`
                  : d.cached
                    ? `${d.date}: no signal`
                    : `${d.date}: not generated — open digest →`
              }
              style={{
                flex: 1,
                height: "100%",
                display: "flex",
                alignItems: "flex-end",
                background: "rgba(160, 174, 192, 0.06)",
                borderRadius: 3,
                overflow: "hidden",
                cursor: d.cached ? "default" : "pointer",
              }}
            >
              {level ? (
                <div
                  style={{
                    width: "100%",
                    height: level.height,
                    background: level.color,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    height: "10%",
                    background: "var(--af-border-subtle)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 6,
          fontSize: 10,
          color: "var(--af-text-tertiary)",
          flexWrap: "wrap",
        }}
      >
        <span>mood (last {days.length}d):</span>
        {(["essential", "helpful", "neutral", "unhelpful"] as const).map((k) => (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 1, background: LEVELS[k].color }} />
            {LEVELS[k].label.toLowerCase()}
          </span>
        ))}
      </div>
    </div>
  );
}
