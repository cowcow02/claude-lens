"use client";

import { LayoutGrid, Table } from "lucide-react";
import { usePersistentBoolean } from "@/lib/use-persistent-boolean";

export type ViewMode = "cards" | "table";

/**
 * Cards/Table view toggle. Persists the choice in localStorage under
 * the given key. Sibling components in the same window stay in sync
 * via the custom event in usePersistentBoolean.
 *
 * Returns a tuple: the current mode, the toggle UI element, and a
 * setter for programmatic changes.
 */
export function useViewToggle(
  storageKey: string,
  defaultMode: ViewMode = "cards",
): { mode: ViewMode; toggle: React.ReactNode; hydrated: boolean } {
  const [isTable, setIsTable, hydrated] = usePersistentBoolean(
    storageKey,
    defaultMode === "table",
  );
  const mode: ViewMode = isTable ? "table" : "cards";

  const toggle = (
    <div
      style={{
        display: "inline-flex",
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <ToggleButton
        active={!isTable}
        onClick={() => setIsTable(false)}
        label="Cards"
        icon={<LayoutGrid size={12} />}
      />
      <ToggleButton
        active={isTable}
        onClick={() => setIsTable(true)}
        label="Table"
        icon={<Table size={12} />}
        rightEdge
      />
    </div>
  );

  return { mode, toggle, hydrated };
}

function ToggleButton({
  active,
  onClick,
  label,
  icon,
  rightEdge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  rightEdge?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "6px 12px",
        fontSize: 11,
        fontWeight: 500,
        background: active ? "var(--af-accent-subtle)" : "transparent",
        color: active ? "var(--af-accent)" : "var(--af-text-secondary)",
        border: "none",
        borderRight: rightEdge ? "none" : "1px solid var(--af-border-subtle)",
        cursor: "pointer",
        letterSpacing: "0.02em",
      }}
    >
      {icon}
      {label}
    </button>
  );
}
