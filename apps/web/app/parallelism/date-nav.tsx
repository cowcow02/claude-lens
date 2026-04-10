"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import Link from "next/link";

type DayInfo = {
  date: string;
  sessions: number;
};

/**
 * Custom date picker for the Timeline page. Shows a mini calendar
 * with session counts per day so the user can identify which days
 * are most interesting to explore.
 */
export function DateNav({
  date,
  today,
  prevDay,
  nextDay,
  dayStats,
}: {
  date: string;
  today: string;
  prevDay?: string;
  nextDay?: string;
  /** Per-day session counts for the calendar heatmap. */
  dayStats: DayInfo[];
}) {
  const router = useRouter();
  const [calOpen, setCalOpen] = useState(false);

  // Parse the selected date to determine the calendar month.
  const [selY, selM] = useMemo(() => {
    const [y, m] = date.split("-").map(Number) as [number, number, number];
    return [y, m];
  }, [date]);

  const [viewY, setViewY] = useState(selY);
  const [viewM, setViewM] = useState(selM);

  // Build a lookup: date → sessions count.
  const statsMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of dayStats) map.set(d.date, d.sessions);
    return map;
  }, [dayStats]);

  // Build calendar grid for the viewed month.
  const calDays = useMemo(() => {
    const firstOfMonth = new Date(viewY, viewM - 1, 1);
    const startDow = firstOfMonth.getDay(); // 0=Sun
    const daysInMonth = new Date(viewY, viewM, 0).getDate();

    const cells: (string | null)[] = [];
    // Leading blanks.
    for (let i = 0; i < startDow; i++) cells.push(null);
    // Days.
    for (let d = 1; d <= daysInMonth; d++) {
      const mm = String(viewM).padStart(2, "0");
      const dd = String(d).padStart(2, "0");
      cells.push(`${viewY}-${mm}-${dd}`);
    }
    return cells;
  }, [viewY, viewM]);

  const maxSessions = useMemo(() => {
    let max = 0;
    for (const d of dayStats) if (d.sessions > max) max = d.sessions;
    return max;
  }, [dayStats]);

  const monthLabel = new Date(viewY, viewM - 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });

  const goMonth = (delta: number) => {
    let m = viewM + delta;
    let y = viewY;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setViewM(m);
    setViewY(y);
  };

  const pickDay = (d: string) => {
    setCalOpen(false);
    router.push(`/parallelism?date=${d}`);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", position: "relative" }}>
      {prevDay ? (
        <Link
          href={`/parallelism?date=${prevDay}`}
          style={{
            padding: "5px 10px",
            border: "1px solid var(--af-border-subtle)",
            borderRadius: 6,
            fontSize: 11,
            color: "var(--af-text-secondary)",
          }}
        >
          ←
        </Link>
      ) : (
        <span style={{ padding: "5px 10px", opacity: 0.3, fontSize: 11, color: "var(--af-text-tertiary)" }}>←</span>
      )}

      {/* Calendar toggle button — shows current date */}
      <button
        type="button"
        onClick={() => {
          setViewY(selY);
          setViewM(selM);
          setCalOpen((p) => !p);
        }}
        style={{
          padding: "5px 12px",
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          border: "1px solid var(--af-border-subtle)",
          borderRadius: 6,
          background: calOpen ? "var(--af-accent-subtle)" : "transparent",
          color: calOpen ? "var(--af-accent)" : "var(--af-text)",
          cursor: "pointer",
          fontWeight: 500,
          minWidth: 120,
          textAlign: "center",
        }}
      >
        {date}
      </button>

      {nextDay ? (
        <Link
          href={`/parallelism?date=${nextDay}`}
          style={{
            padding: "5px 10px",
            border: "1px solid var(--af-border-subtle)",
            borderRadius: 6,
            fontSize: 11,
            color: "var(--af-text-secondary)",
          }}
        >
          →
        </Link>
      ) : (
        <span style={{ padding: "5px 10px", opacity: 0.3, fontSize: 11, color: "var(--af-text-tertiary)" }}>→</span>
      )}

      <Link
        href={`/parallelism?date=${today}`}
        style={{
          padding: "5px 12px",
          border: "1px solid var(--af-border-subtle)",
          borderRadius: 6,
          fontSize: 11,
          color: date === today ? "var(--af-accent)" : "var(--af-text-secondary)",
          background: date === today ? "var(--af-accent-subtle)" : "transparent",
          fontWeight: 500,
        }}
      >
        Today
      </Link>

      {/* Calendar popover */}
      {calOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            zIndex: 60,
            background: "var(--af-surface)",
            border: "1px solid var(--af-border-subtle)",
            borderRadius: 10,
            padding: "12px 14px",
            boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
            minWidth: 280,
          }}
        >
          {/* Month header with arrows */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 10,
            }}
          >
            <button
              type="button"
              onClick={() => goMonth(-1)}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--af-text-secondary)",
                fontSize: 14,
                padding: "2px 8px",
                borderRadius: 4,
              }}
            >
              ‹
            </button>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--af-text)" }}>
              {monthLabel}
            </span>
            <button
              type="button"
              onClick={() => goMonth(1)}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--af-text-secondary)",
                fontSize: 14,
                padding: "2px 8px",
                borderRadius: 4,
              }}
            >
              ›
            </button>
          </div>

          {/* Weekday headers */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 2,
              marginBottom: 4,
            }}
          >
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
              <div
                key={d}
                style={{
                  textAlign: "center",
                  fontSize: 9,
                  color: "var(--af-text-tertiary)",
                  fontWeight: 600,
                  padding: "2px 0",
                }}
              >
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 2,
            }}
          >
            {calDays.map((day, i) => {
              if (!day) {
                return <div key={`blank-${i}`} />;
              }
              const count = statsMap.get(day) ?? 0;
              const isSelected = day === date;
              const isToday = day === today;
              const isFuture = day > today;

              // Intensity based on session count.
              const intensity =
                count > 0 && maxSessions > 0
                  ? Math.min(1, count / maxSessions)
                  : 0;

              const dayNum = parseInt(day.split("-")[2]!, 10);

              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => pickDay(day)}
                  disabled={isFuture}
                  title={count > 0 ? `${day}: ${count} session${count === 1 ? "" : "s"}` : day}
                  style={{
                    width: 34,
                    height: 34,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 1,
                    border: isSelected
                      ? "2px solid var(--af-accent)"
                      : isToday
                        ? "1px solid var(--af-text-tertiary)"
                        : "1px solid transparent",
                    borderRadius: 6,
                    background:
                      intensity > 0
                        ? `rgba(45, 212, 191, ${0.08 + intensity * 0.3})`
                        : "transparent",
                    color: isFuture
                      ? "var(--af-text-tertiary)"
                      : isSelected
                        ? "var(--af-accent)"
                        : "var(--af-text)",
                    cursor: isFuture ? "not-allowed" : "pointer",
                    fontSize: 11,
                    fontWeight: isSelected ? 700 : 400,
                    fontFamily: "var(--font-mono)",
                    padding: 0,
                    opacity: isFuture ? 0.4 : 1,
                  }}
                >
                  <span>{dayNum}</span>
                  {count > 0 && (
                    <span
                      style={{
                        fontSize: 7,
                        color: isSelected ? "var(--af-accent)" : "var(--af-text-tertiary)",
                        lineHeight: 1,
                        fontWeight: 600,
                      }}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 10,
              paddingTop: 8,
              borderTop: "1px solid var(--af-border-subtle)",
              fontSize: 9,
              color: "var(--af-text-tertiary)",
            }}
          >
            <span>fewer sessions</span>
            <div style={{ display: "flex", gap: 3 }}>
              {[0, 0.15, 0.3, 0.5, 0.8].map((v, i) => (
                <span
                  key={i}
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background:
                      v === 0
                        ? "var(--af-border-subtle)"
                        : `rgba(45, 212, 191, ${0.08 + v * 0.3})`,
                  }}
                />
              ))}
            </div>
            <span>more sessions</span>
          </div>
        </div>
      )}
    </div>
  );
}
