import type { AgentKind } from "@claude-lens/parser";

type AgentBadgeProps = {
  /** Source agent. Undefined is treated as legacy claude-code (no badge). */
  agent?: AgentKind;
};

/**
 * Shown only for non-Claude sources. Claude rows render identically to
 * before so existing screenshots / muscle memory still match.
 */
export function AgentBadge({ agent }: AgentBadgeProps) {
  if (!agent || agent === "claude-code") return null;
  if (agent === "codex") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          borderRadius: 4,
          padding: "2px 6px",
          fontSize: 10,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          fontWeight: 600,
          background: "rgba(16, 163, 127, 0.12)",
          color: "rgb(16, 163, 127)",
          border: "1px solid rgba(16, 163, 127, 0.3)",
        }}
        title="Source: OpenAI Codex CLI"
      >
        Codex
      </span>
    );
  }
  return null;
}
