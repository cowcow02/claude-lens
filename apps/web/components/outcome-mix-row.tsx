import type { DayOutcome } from "@claude-lens/entries";
import { OutcomePill } from "./outcome-pill";

/**
 * Horizontal row of outcome pills, oldest→newest left-to-right.
 * Days without an outcome render as a faint placeholder dot.
 */
export function OutcomeMixRow({
  days,
  size = "sm",
}: {
  days: Array<{ date: string; outcome: DayOutcome | null }>;
  size?: "sm" | "md";
}) {
  return (
    <div style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      {days.map((d) =>
        d.outcome ? (
          <OutcomePill key={d.date} outcome={d.outcome} size={size} label="icon" />
        ) : (
          <span
            key={d.date}
            title={`${d.date} — no entries`}
            style={{
              display: "inline-block",
              width: size === "sm" ? 14 : 18,
              height: size === "sm" ? 14 : 18,
              borderRadius: 99,
              background: "var(--af-border-subtle)",
              opacity: 0.5,
            }}
          />
        )
      )}
    </div>
  );
}
