"use client";

import { type ReactNode, useState } from "react";
import { Info } from "lucide-react";

export function MetricCard({
  label,
  value,
  sub,
  icon,
  tooltip,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tooltip?: string;
}) {
  const [showTip, setShowTip] = useState(false);

  return (
    <div className="af-card" style={{ padding: "16px 18px", position: "relative" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 11,
          color: "var(--af-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontWeight: 600,
        }}
      >
        {icon}
        <span>{label}</span>
        {tooltip && (
          <span
            style={{
              marginLeft: "auto",
              cursor: "help",
              display: "inline-flex",
              color: "var(--af-text-tertiary)",
              opacity: 0.5,
              transition: "opacity 0.12s",
            }}
            onMouseEnter={() => setShowTip(true)}
            onMouseLeave={() => setShowTip(false)}
            onClick={() => setShowTip((v) => !v)}
          >
            <Info size={12} />
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          marginTop: 8,
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "var(--af-text-secondary)", marginTop: 4 }}>{sub}</div>
      )}
      {showTip && tooltip && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 50,
            background: "#0F172A",
            color: "#F1F5F9",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 11,
            lineHeight: 1.5,
            boxShadow: "0 6px 24px rgba(15,23,42,0.22)",
            pointerEvents: "none",
          }}
        >
          {tooltip.split("\n").map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}
