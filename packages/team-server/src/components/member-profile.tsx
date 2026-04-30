import { formatAgentTime, formatTokens } from "../lib/format";
import type { RollupRow } from "../lib/queries";

// 30-day day-by-day activity shape + drill-down table. Identity/role and
// 30-day totals moved up into the page-level header so this component
// stays focused on the per-day breakdown.
export function MemberProfile({ rollups }: { rollups: RollupRow[] }) {
  const maxDayMs = Math.max(...rollups.map((r) => Number(r.agent_time_ms)), 1);

  return (
    <section style={{ marginTop: 24 }}>
      <div className="subsection-head">
        <h2>Daily activity</h2>
        <span className="kicker">30-day shape · hover any bar for that day's agent time</span>
      </div>
      <div className="activity-chart">
        {rollups.length === 0 && (
          <div
            style={{
              color: "var(--mute)",
              fontSize: 13,
              width: "100%",
              textAlign: "center",
              padding: 40,
            }}
          >
            No activity recorded in this window.
          </div>
        )}
        {rollups.map((r) => {
          const ms = Number(r.agent_time_ms);
          const height = Math.max(2, (ms / maxDayMs) * 100);
          return (
            <div
              key={r.day}
              className={`activity-bar ${ms === 0 ? "zero" : ""}`}
              style={{ height: `${height}%` }}
              title={`${r.day}: ${formatAgentTime(ms)}`}
            />
          );
        })}
      </div>
      {rollups.length > 0 && (
        <div className="activity-axis">
          <span>{rollups[0].day}</span>
          <span>{rollups[rollups.length - 1].day}</span>
        </div>
      )}

      {/* Drill-down: per-day numbers. Collapsed by default — the bar
          chart above already conveys shape; only power users want the
          exact per-day rows. */}
      <details style={{ marginTop: 20 }}>
        <summary
          className="subsection-head"
          style={{ cursor: "pointer", listStyle: "revert" }}
        >
          <h2 style={{ display: "inline" }}>Daily breakdown</h2>
          <span className="kicker"> · per-day numbers · click to expand</span>
        </summary>
        {rollups.length === 0 ? (
          <div style={{ color: "var(--mute)", fontSize: 13, padding: "24px 0" }}>No data.</div>
        ) : (
          <table className="data" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Day</th>
                <th>Agent</th>
                <th>Sessions</th>
                <th>Tool calls</th>
                <th>Tokens</th>
              </tr>
            </thead>
            <tbody>
              {rollups
                .slice()
                .reverse()
                .map((r) => (
                  <tr key={r.day}>
                    <td>{r.day}</td>
                    <td>{formatAgentTime(Number(r.agent_time_ms))}</td>
                    <td>{r.sessions}</td>
                    <td>{r.tool_calls}</td>
                    <td>
                      {formatTokens(
                        Number(r.tokens_input) +
                          Number(r.tokens_output) +
                          Number(r.tokens_cache_read) +
                          Number(r.tokens_cache_write),
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </details>
    </section>
  );
}
