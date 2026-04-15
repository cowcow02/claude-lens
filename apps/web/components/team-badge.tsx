import Link from "next/link";
import type { SessionMeta } from "@claude-lens/parser";

const BASE_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 4,
  padding: "2px 6px",
  fontSize: 10,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
} as const;

export function TeamBadge({ session }: { session: SessionMeta }) {
  if (!session.teamName) return null;
  const isLead = !session.agentName;

  if (isLead) {
    return (
      <Link
        href={`/sessions/${session.sessionId}`}
        style={{
          ...BASE_STYLE,
          fontWeight: 600,
          background: "var(--af-warning-subtle)",
          color: "var(--af-warning)",
          border: "1px solid var(--af-warning-subtle)",
          textDecoration: "none",
        }}
        title={`Team lead — ${session.teamName}`}
      >
        Team Lead
      </Link>
    );
  }

  return (
    <span
      style={{
        ...BASE_STYLE,
        fontWeight: 500,
        background: "var(--af-surface-hover)",
        color: "var(--af-text-tertiary)",
        border: "1px solid var(--af-border-subtle)",
      }}
      title={`Team member — ${session.teamName}${session.agentName ? ` · ${session.agentName}` : ""}`}
    >
      Team Member
    </span>
  );
}
