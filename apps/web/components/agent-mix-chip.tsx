import type { AgentBreakdown } from "@claude-lens/parser";

const LABELS: Record<string, string> = {
  "claude-code": "Claude",
  codex: "Codex",
};

const COLORS: Record<string, string> = {
  "claude-code": "var(--af-text-secondary)",
  codex: "rgb(16, 163, 127)",
};

/**
 * Inline chip that surfaces "12 Claude · 3 Codex" on a project row when
 * the project has activity from more than one source. Returns null when
 * there's only one agent — keeps single-agent rows visually unchanged.
 */
export function AgentMixChip({ perAgent }: { perAgent: AgentBreakdown[] }) {
  if (perAgent.length < 2) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10,
        fontFamily: "var(--font-mono)",
        color: "var(--af-text-tertiary)",
        whiteSpace: "nowrap",
      }}
      title="Sessions split by source agent"
    >
      {perAgent.map((row, i) => (
        <span key={row.agent}>
          {i > 0 && <span style={{ margin: "0 4px", opacity: 0.5 }}>·</span>}
          <span style={{ color: COLORS[row.agent] ?? "inherit", fontWeight: 600 }}>
            {row.sessions}
          </span>{" "}
          {LABELS[row.agent] ?? row.agent}
        </span>
      ))}
    </span>
  );
}
