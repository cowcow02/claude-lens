"use client";

import { useState } from "react";

export type RangePreset = "current" | "7d" | "30d" | "90d" | "custom";

export type DateRange = {
  preset: RangePreset;
  /** Absolute start timestamp (ms). Undefined when preset === "current". */
  startMs?: number;
  /** Absolute end timestamp (ms). Undefined when preset === "current". */
  endMs?: number;
};

const DAY = 24 * 60 * 60 * 1000;

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "current", label: "Current cycle" },
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "custom", label: "Custom" },
];

export function resolveRange(range: DateRange): { startMs?: number; endMs?: number } {
  const now = Date.now();
  switch (range.preset) {
    case "current":
      return {};
    case "7d":
      return { startMs: now - 7 * DAY, endMs: now };
    case "30d":
      return { startMs: now - 30 * DAY, endMs: now };
    case "90d":
      return { startMs: now - 90 * DAY, endMs: now };
    case "custom":
      return { startMs: range.startMs, endMs: range.endMs };
  }
}

export function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (next: DateRange) => void;
}) {
  const [customStart, setCustomStart] = useState<string>(() =>
    value.startMs ? toDateInputValue(value.startMs) : toDateInputValue(Date.now() - 7 * DAY),
  );
  const [customEnd, setCustomEnd] = useState<string>(() =>
    value.endMs ? toDateInputValue(value.endMs) : toDateInputValue(Date.now()),
  );

  const selectPreset = (preset: RangePreset) => {
    if (preset === "custom") {
      onChange({
        preset,
        startMs: fromDateInputValue(customStart),
        endMs: fromDateInputValue(customEnd),
      });
    } else {
      onChange({ preset });
    }
  };

  const applyCustom = () => {
    onChange({
      preset: "custom",
      startMs: fromDateInputValue(customStart),
      endMs: fromDateInputValue(customEnd),
    });
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          borderRadius: 6,
          border: "1px solid var(--af-border-subtle)",
          overflow: "hidden",
        }}
      >
        {PRESETS.map((p, i) => (
          <button
            key={p.key}
            type="button"
            onClick={() => selectPreset(p.key)}
            style={{
              padding: "6px 12px",
              fontSize: 11,
              fontWeight: 500,
              background:
                value.preset === p.key ? "var(--af-accent-subtle)" : "transparent",
              color:
                value.preset === p.key ? "var(--af-accent)" : "var(--af-text-secondary)",
              border: "none",
              borderRight:
                i < PRESETS.length - 1 ? "1px solid var(--af-border-subtle)" : "none",
              cursor: "pointer",
              letterSpacing: "0.02em",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      {value.preset === "custom" && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            style={datePickerStyle}
          />
          <span style={{ fontSize: 11, color: "var(--af-text-tertiary)" }}>→</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            style={datePickerStyle}
          />
          <button
            type="button"
            onClick={applyCustom}
            style={{
              padding: "5px 12px",
              fontSize: 11,
              fontWeight: 500,
              background: "var(--af-accent-subtle)",
              color: "var(--af-accent)",
              border: "1px solid var(--af-accent-subtle)",
              borderRadius: 5,
              cursor: "pointer",
            }}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

const datePickerStyle: React.CSSProperties = {
  padding: "5px 8px",
  fontSize: 11,
  background: "var(--background)",
  color: "var(--af-text)",
  border: "1px solid var(--af-border-subtle)",
  borderRadius: 5,
  fontFamily: "var(--font-mono)",
};

function toDateInputValue(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fromDateInputValue(value: string): number {
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).getTime();
}
