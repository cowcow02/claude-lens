"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

/**
 * Generic sortable table. Each column provides a `sortValue` function
 * so we can sort by something other than the displayed `render`
 * output (e.g. render a relative date but sort by absolute epoch ms).
 *
 * Click a column header to sort by it. First click = descending.
 * Click the same header again to flip direction, or a different
 * header to switch sort column.
 */
export type Column<T> = {
  key: string;
  header: string;
  /** Value used for sorting — must return a number or string */
  sortValue?: (row: T) => number | string;
  /** Content renderer for the cell */
  render: (row: T) => ReactNode;
  /** Optional CSS width / text align */
  width?: string | number;
  align?: "left" | "right" | "center";
  /** Disable sorting for this column (e.g. preview/action columns) */
  sortable?: boolean;
};

export function DataTable<T>({
  rows,
  columns,
  getRowKey,
  onRowClick,
  defaultSortKey,
  defaultSortDir = "desc",
}: {
  rows: T[];
  columns: Column<T>[];
  getRowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  defaultSortKey?: string;
  defaultSortDir?: "asc" | "desc";
}) {
  const [sortKey, setSortKey] = useState<string | null>(defaultSortKey ?? null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col || !col.sortValue) return rows;
    const mult = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * mult;
      return String(av).localeCompare(String(bv)) * mult;
    });
  }, [rows, columns, sortKey, sortDir]);

  const handleHeaderClick = (col: Column<T>) => {
    if (col.sortable === false || !col.sortValue) return;
    if (sortKey === col.key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col.key);
      setSortDir("desc");
    }
  };

  return (
    <div
      style={{
        overflowX: "auto",
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 8,
        background: "var(--af-surface)",
      }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 12,
          color: "var(--af-text)",
        }}
      >
        <thead>
          <tr>
            {columns.map((col) => {
              const isSorted = sortKey === col.key;
              const isSortable = col.sortable !== false && !!col.sortValue;
              return (
                <th
                  key={col.key}
                  onClick={() => handleHeaderClick(col)}
                  style={{
                    textAlign: col.align ?? "left",
                    fontSize: 10,
                    fontWeight: 600,
                    color: isSorted ? "var(--af-accent)" : "var(--af-text-tertiary)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    padding: "10px 12px",
                    borderBottom: "1px solid var(--af-border-subtle)",
                    cursor: isSortable ? "pointer" : "default",
                    userSelect: "none",
                    whiteSpace: "nowrap",
                    width: col.width,
                    background: "var(--af-surface)",
                    position: "sticky",
                    top: 0,
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      verticalAlign: "middle",
                    }}
                  >
                    {col.header}
                    {isSortable && (
                      <span style={{ display: "inline-flex", opacity: isSorted ? 1 : 0.35 }}>
                        {!isSorted ? (
                          <ArrowUpDown size={10} />
                        ) : sortDir === "asc" ? (
                          <ArrowUp size={10} />
                        ) : (
                          <ArrowDown size={10} />
                        )}
                      </span>
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={getRowKey(row)}
              onClick={() => onRowClick?.(row)}
              style={{
                cursor: onRowClick ? "pointer" : "default",
                borderBottom: "1px solid var(--af-border-subtle)",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLTableRowElement).style.background =
                  "var(--af-surface-hover)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLTableRowElement).style.background = "";
              }}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  style={{
                    padding: "10px 12px",
                    textAlign: col.align ?? "left",
                    whiteSpace: col.align === "right" ? "nowrap" : undefined,
                    verticalAlign: "top",
                  }}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td
                colSpan={columns.length}
                style={{
                  padding: "32px 16px",
                  textAlign: "center",
                  fontSize: 12,
                  color: "var(--af-text-tertiary)",
                }}
              >
                No rows to display.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
