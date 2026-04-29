"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, History, X } from "lucide-react";
import { InsightsHistory } from "./insights-history";

type NavTarget = { key: string; label: string; cached: boolean };

export function InsightsTopBar({
  scope,           // "week" | "month"
  currentLabel,    // primary label, e.g. "Week of 2026-04-20" or "Apr 2026"
  rangeLabel,      // optional secondary, e.g. "Apr 20 — Apr 26"
  prev,
  next,
}: {
  scope: "week" | "month";
  currentLabel: string;
  rangeLabel?: string;
  prev: NavTarget | null;
  next: NavTarget | null;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  return (
    <>
      <header style={{
        position: "sticky", top: 0, zIndex: 50,
        background: "color-mix(in srgb, var(--af-bg) 88%, transparent)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        borderBottom: "1px solid var(--af-border-subtle)",
      }} className="no-print">
        <div style={{
          maxWidth: 980, margin: "0 auto", padding: "12px 40px",
          display: "flex", alignItems: "center", gap: 14, minHeight: 44,
        }}>
          {/* Title cluster */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
            <Link href="/insights" style={{
              fontSize: 10, fontWeight: 700, color: "var(--af-text-tertiary)",
              textDecoration: "none", textTransform: "uppercase",
              letterSpacing: "0.08em", flexShrink: 0,
            }} title="Latest week digest">
              Insights
            </Link>
            <span style={{ color: "var(--af-text-tertiary)", fontSize: 11, flexShrink: 0 }}>›</span>
            <span style={{
              fontSize: 14, fontWeight: 600, color: "var(--af-text)",
              letterSpacing: "-0.01em", minWidth: 0, overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {currentLabel}
            </span>
            {rangeLabel && (
              <span style={{
                fontSize: 11, fontFamily: "var(--font-mono)",
                color: "var(--af-text-tertiary)", flexShrink: 0,
              }}>
                {rangeLabel}
              </span>
            )}
          </div>

          {/* Nav cluster */}
          <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <NavArrow target={prev} dir="prev" />
            <NavArrow target={next} dir="next" />
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              style={historyBtnStyle}
              title={`Browse ${scope === "week" ? "weekly" : "monthly"} history`}
            >
              <History size={13} />
              <span>Browse</span>
            </button>
          </div>
        </div>
      </header>

      {drawerOpen && (
        <HistoryDrawer onClose={() => setDrawerOpen(false)} />
      )}
    </>
  );
}

function NavArrow({ target, dir }: { target: NavTarget | null; dir: "prev" | "next" }) {
  const Icon = dir === "prev" ? ChevronLeft : ChevronRight;
  if (!target) {
    return (
      <span style={navBtnStyleDisabled} title={`No ${dir === "prev" ? "earlier" : "later"} period`}>
        <Icon size={14} />
      </span>
    );
  }
  return (
    <Link
      href={`/insights/${target.key}`}
      style={navBtnStyle(target.cached)}
      title={
        target.cached
          ? `Saved digest · ${target.label}`
          : `${target.label} (no saved digest yet — will prompt to Generate)`
      }
    >
      <Icon size={14} />
      <span>{target.label}</span>
    </Link>
  );
}

function HistoryDrawer({ onClose }: { onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label="Insights history" style={{
      position: "fixed", inset: 0, zIndex: 200,
      display: "flex", justifyContent: "flex-end",
    }}>
      <div
        onClick={onClose}
        style={{
          position: "absolute", inset: 0,
          background: "rgba(0,0,0,0.32)",
          animation: "fade-in 120ms ease-out",
        }}
      />
      <aside style={{
        position: "relative",
        width: "min(440px, 92vw)", height: "100vh",
        background: "var(--af-bg)",
        borderLeft: "1px solid var(--af-border-subtle)",
        boxShadow: "-8px 0 30px rgba(0,0,0,0.18)",
        display: "flex", flexDirection: "column",
        animation: "slide-in 160ms cubic-bezier(0.2, 0.9, 0.3, 1)",
      }}>
        <header style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 18px", borderBottom: "1px solid var(--af-border-subtle)",
        }}>
          <h2 style={{
            fontSize: 13, fontWeight: 600, margin: 0, color: "var(--af-text)",
          }}>
            Browse insights history
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close history"
            style={{
              marginLeft: "auto", width: 26, height: 26,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              border: "1px solid var(--af-border-subtle)", borderRadius: 6,
              background: "transparent", color: "var(--af-text-secondary)",
              cursor: "pointer",
            }}
          >
            <X size={14} />
          </button>
        </header>
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 0" }}>
          <InsightsHistory inDrawer />
        </div>
      </aside>
      <style>{`
        @keyframes slide-in { from { transform: translateX(20px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }
        @keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }
      `}</style>
    </div>
  );
}

const historyBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "5px 11px", borderRadius: 6,
  border: "1px solid var(--af-border-subtle)",
  background: "var(--af-surface)",
  color: "var(--af-text)",
  fontSize: 11, fontWeight: 500, cursor: "pointer",
  fontFamily: "inherit",
};

function navBtnStyle(cached: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 4,
    padding: "5px 9px", borderRadius: 6,
    border: `1px solid ${cached ? "color-mix(in srgb, var(--af-accent) 28%, var(--af-border))" : "var(--af-border-subtle)"}`,
    background: cached ? "color-mix(in srgb, var(--af-accent) 6%, var(--af-surface))" : "var(--af-surface)",
    color: cached ? "var(--af-accent)" : "var(--af-text-secondary)",
    fontSize: 11, fontWeight: 500, fontFamily: "var(--font-mono)",
    textDecoration: "none",
  };
}

const navBtnStyleDisabled: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4,
  padding: "5px 9px", borderRadius: 6,
  border: "1px solid var(--af-border-subtle)",
  background: "var(--af-surface)",
  color: "var(--af-text-tertiary)",
  fontSize: 11, fontWeight: 500, fontFamily: "var(--font-mono)",
  opacity: 0.45, cursor: "default",
};
