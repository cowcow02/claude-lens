import { formatAgentTime, formatTokens, timeAgo } from "../lib/format";
import type { RosterRow } from "../lib/queries";

export function RosterCard({ member, teamSlug }: { member: RosterRow; teamSlug: string }) {
  const lastSeenMs = member.last_seen_at ? Date.now() - new Date(member.last_seen_at).getTime() : Infinity;
  const isActive = lastSeenMs < 15 * 60 * 1000;

  return (
    <a href={`/team/${teamSlug}/members/${member.id}`} className="roster-card">
      <div className="roster-card-chevron">→</div>
      <div className="roster-card-head">
        <div>
          <div className="roster-card-name">{member.display_name || member.email || "Anonymous"}</div>
          {member.email && member.display_name && (
            <div className="roster-card-email">{member.email}</div>
          )}
          <div className={`roster-card-lastseen ${isActive ? "active" : ""}`} style={{ marginTop: 10 }}>
            {timeAgo(member.last_seen_at).toLowerCase()}
          </div>
        </div>
        <span className={`roster-card-role ${member.role === "admin" ? "admin" : ""}`}>
          {member.role}
        </span>
      </div>

      <div className="roster-card-stats">
        <div className="roster-card-stat">
          <span className="roster-card-stat-label">Agent</span>
          <span className="roster-card-stat-value">{formatAgentTime(Number(member.week_agent_time_ms))}</span>
        </div>
        <div className="roster-card-stat">
          <span className="roster-card-stat-label">Sessions</span>
          <span className="roster-card-stat-value">{member.week_sessions}</span>
        </div>
        <div className="roster-card-stat">
          <span className="roster-card-stat-label">Tokens</span>
          <span className="roster-card-stat-value">{formatTokens(Number(member.week_tokens))}</span>
        </div>
      </div>
    </a>
  );
}
