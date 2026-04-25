"use client";

import { useState } from "react";
import { PLAN_TIERS_IN_ORDER, PLAN_TIERS } from "../lib/plan-tiers";

type MemberRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  plan_tier: string;
  revoked_at: string | null;
};

const ALL_KEYS = [...PLAN_TIERS_IN_ORDER.map((t) => t.key), "custom" as const];

export function MemberTierEditor({ members }: { members: MemberRow[] }) {
  const active = members.filter((m) => !m.revoked_at);
  if (active.length === 0) {
    return (
      <p style={{ color: "var(--mute)", fontSize: 13 }}>No active members yet.</p>
    );
  }
  return (
    <table className="member-table">
      <thead>
        <tr>
          <th>Member</th>
          <th>Plan tier</th>
        </tr>
      </thead>
      <tbody>
        {active.map((m) => (
          <TierRow key={m.id} member={m} />
        ))}
      </tbody>
    </table>
  );
}

function TierRow({ member }: { member: MemberRow }) {
  const [tier, setTier] = useState(member.plan_tier);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: string) {
    const prev = tier;
    setTier(next);
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/team/members/${member.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planTier: next }),
    });
    setSaving(false);
    if (!res.ok) {
      setTier(prev);
      const body = await res.json().catch(() => ({}));
      setError(body.error || "Save failed");
    }
  }

  return (
    <tr>
      <td>
        {member.display_name || member.email || "(unnamed)"}
        {member.email && member.display_name && (
          <div className="mono" style={{ fontSize: 11, color: "var(--mute)" }}>
            {member.email}
          </div>
        )}
      </td>
      <td>
        <select
          value={tier}
          onChange={(e) => save(e.target.value)}
          disabled={saving}
          style={{
            padding: "6px 10px",
            border: "1px solid var(--rule)",
            background: "var(--bg)",
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 12,
          }}
        >
          {ALL_KEYS.map((k) => (
            <option key={k} value={k}>
              {PLAN_TIERS[k].label}
              {PLAN_TIERS[k].weeklyLimitUsd > 0
                ? ` ($${PLAN_TIERS[k].weeklyLimitUsd}/wk)`
                : ""}
            </option>
          ))}
        </select>
        {error && (
          <div style={{ color: "#a93b2c", fontSize: 11, marginTop: 4 }}>{error}</div>
        )}
      </td>
    </tr>
  );
}
