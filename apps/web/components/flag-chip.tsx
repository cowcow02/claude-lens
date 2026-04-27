"use client";

import { flagDef } from "@claude-lens/entries";
import type { ReactNode } from "react";

const TONE_COLOR: Record<"warn" | "info" | "ok", string> = {
  warn: "#ed8936",
  info: "#4299e1",
  ok: "#48bb78",
};

/** Inline chip rendering an internal flag token using the user-facing label
 *  from FLAG_GLOSSARY, with the technical definition exposed via tooltip. */
export function FlagChip({ token, count }: { token: string; count?: number }) {
  const def = flagDef(token);
  const c = TONE_COLOR[def.tone];
  return (
    <span
      title={`${def.token} — ${def.description}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 8px", borderRadius: 999,
        background: `color-mix(in srgb, ${c} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${c} 28%, transparent)`,
        fontSize: 10, fontWeight: 600,
        color: c, fontFamily: "var(--font-mono)",
        whiteSpace: "nowrap",
      }}
    >
      {def.label}
      {typeof count === "number" && (
        <span style={{ opacity: 0.7, fontWeight: 500 }}>×{count}</span>
      )}
    </span>
  );
}

const KNOWN_FLAG_TOKENS = [
  "loop_suspected", "long_autonomous", "orchestrated",
  "fast_ship", "plan_used", "interrupt_heavy", "high_errors",
];

/** Replace any raw flag tokens in a string with <FlagChip> for inline rendering.
 *  Defensive against LLM output that slipped a token through despite the
 *  system-prompt forbidding it. */
export function renderWithFlagChips(text: string): ReactNode[] {
  const pattern = new RegExp(`\\b(${KNOWN_FLAG_TOKENS.join("|")})\\b`, "g");
  const out: ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIdx) out.push(text.slice(lastIdx, match.index));
    out.push(<FlagChip key={`${match.index}-${match[1]}`} token={match[1]!} />);
    lastIdx = pattern.lastIndex;
  }
  if (lastIdx < text.length) out.push(text.slice(lastIdx));
  return out.length > 0 ? out : [text];
}
