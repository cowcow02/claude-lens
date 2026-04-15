"use client";

import { useEffect } from "react";
import type { PresentationRow, ContentBlock } from "@claude-lens/parser";
import type { TeamTurn } from "./adapter";

type Props = {
  turn: TeamTurn | null;
  trackLabel: string;
  trackColor: string;
  onClose: () => void;
};

export function TurnDrawer({ turn, trackLabel, trackColor, onClose }: Props) {
  useEffect(() => {
    if (!turn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [turn, onClose]);

  if (!turn) return null;

  const summary = turn.megaRow.summary;
  const startStr = new Date(turn.startMs).toLocaleString();
  const endStr = new Date(turn.endMs).toLocaleTimeString();
  const durationStr = formatDuration(turn.durationMs);

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          zIndex: 1000,
        }}
      />
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 480,
          background: "var(--af-surface-elevated)",
          borderLeft: "1px solid var(--af-border-subtle)",
          zIndex: 1001,
          display: "flex",
          flexDirection: "column",
          fontSize: 12,
          color: "var(--af-text)",
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--af-border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: trackColor,
                letterSpacing: "0.08em",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              {trackLabel}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--af-text-tertiary)",
                fontFamily: "ui-monospace, monospace",
                marginTop: 2,
              }}
            >
              {startStr} → {endStr} · {durationStr}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "1px solid var(--af-border-subtle)",
              color: "var(--af-text-secondary)",
              width: 28,
              height: 28,
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            padding: "8px 16px",
            borderBottom: "1px solid var(--af-border-subtle)",
            display: "flex",
            gap: 8,
            fontSize: 11,
            color: "var(--af-text-tertiary)",
            fontFamily: "ui-monospace, monospace",
            flexShrink: 0,
          }}
        >
          <span>{summary.agentMessages} msg</span>
          <span>·</span>
          <span>{summary.toolCalls} tools</span>
          {summary.errors > 0 && (
            <>
              <span>·</span>
              <span style={{ color: "#f85149" }}>{summary.errors} errors</span>
            </>
          )}
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "12px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {turn.megaRow.rows.map((row, i) => (
            <RowBlock key={i} row={row} trackColor={trackColor} />
          ))}
        </div>
      </div>
    </>
  );
}

function RowBlock({
  row,
  trackColor,
}: {
  row: PresentationRow;
  trackColor: string;
}) {
  switch (row.kind) {
    case "user":
      return (
        <Section label="HUMAN" color={trackColor}>
          <Text>
            {row.displayPreview ?? row.event.preview ?? ""}
          </Text>
        </Section>
      );
    case "agent": {
      const fullText = blocksText(row.event.blocks);
      return (
        <Section label="AGENT" color={trackColor}>
          <Text>{fullText || row.event.preview || ""}</Text>
        </Section>
      );
    }
    case "tool-group":
      return (
        <Section label="TOOLS" color={trackColor}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {row.toolNames.map((t) => (
              <span
                key={t.name}
                style={{
                  fontSize: 10,
                  padding: "2px 7px",
                  background: "var(--af-surface-hover)",
                  borderRadius: 3,
                  color: "var(--af-text-secondary)",
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                {t.name}
                {t.count > 1 ? ` ×${t.count}` : ""}
              </span>
            ))}
          </div>
        </Section>
      );
    case "error":
      return (
        <Section label="ERROR" color="#f85149">
          <Text>{row.message}</Text>
        </Section>
      );
    case "interrupt":
      return (
        <Section label="INTERRUPT" color="#db6d28">
          <Text>{row.event.preview ?? ""}</Text>
        </Section>
      );
    case "model":
      return (
        <Section label="MODEL" color={trackColor}>
          <Text>{row.event.preview ?? ""}</Text>
        </Section>
      );
    case "task-notification":
      return (
        <Section label="TASK" color={trackColor}>
          <Text>
            [{row.status}] {row.summary}
          </Text>
        </Section>
      );
  }
}

function Section({
  label,
  color,
  children,
}: {
  label: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 9,
          fontWeight: 700,
          color,
          letterSpacing: "0.08em",
          fontFamily: "ui-monospace, monospace",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function Text({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 12,
        color: "var(--af-text)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

function blocksText(blocks: ContentBlock[] | undefined): string {
  if (!blocks) return "";
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
  }
  return parts.join("\n\n");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3600_000).toFixed(1)}h`;
}
