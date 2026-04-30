"use client";

import { useState } from "react";
import type { OptimizerSettings } from "../lib/plan-optimizer";

type Props = {
  teamSlug: string;
  settings: OptimizerSettings;
};

const FIELDS: Array<{
  key: keyof OptimizerSettings;
  label: string;
  hint: string;
  min: number;
  max: number;
}> = [
  {
    key: "minDaysRequired",
    label: "Min days observed",
    hint: "Days of daemon activity required before a recommendation",
    min: 7,
    max: 30,
  },
  {
    key: "upgradeIfAvgAbove",
    label: "Upgrade if avg ≥",
    hint: "30-day average 7-day utilization that triggers an upgrade suggestion",
    min: 50,
    max: 95,
  },
  {
    key: "urgentUpgradeIfMaxAbove",
    label: "Urgent if peak ≥",
    hint: "Peak 7-day utilization on entry tier that flags an urgent upgrade",
    min: 80,
    max: 100,
  },
  {
    key: "downgradeIfAvgBelow",
    label: "Downgrade if avg <",
    hint: "30-day average below this is a downgrade candidate",
    min: 10,
    max: 60,
  },
  {
    key: "downgradeIfMaxBelow",
    label: "Downgrade if peak <",
    hint: "Peak must also be below this for a downgrade to fire",
    min: 30,
    max: 80,
  },
];

export function PlanTuningForm({ teamSlug, settings }: Props) {
  const [draft, setDraft] = useState<OptimizerSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const dirty = FIELDS.some((f) => draft[f.key] !== settings[f.key]);

  async function save() {
    setSaving(true);
    setMessage(null);
    const res = await fetch(`/api/team/settings?team=${teamSlug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planOptimizer: draft }),
    });
    setSaving(false);
    setMessage(res.ok ? "Saved." : "Failed to save.");
    if (res.ok) {
      // Recommendations are derived from these thresholds; reload so the
      // /plan page recomputes against the new values without confusing the
      // admin about "did the slider take?".
      setTimeout(() => window.location.reload(), 600);
    }
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--mute)", marginTop: 0 }}>
        Tune the recommendation thresholds. Changes affect the next page load.
      </p>
      <div style={{ display: "grid", gap: 18, maxWidth: 560 }}>
        {FIELDS.map((f) => (
          <label key={f.key} style={{ display: "block" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span className="mono" style={{ fontSize: 12, letterSpacing: "0.05em" }}>
                {f.label}
              </span>
              <span className="mono" style={{ fontSize: 12, color: "var(--ink)" }}>
                {draft[f.key]}
              </span>
            </div>
            <input
              type="range"
              min={f.min}
              max={f.max}
              value={draft[f.key]}
              onChange={(e) =>
                setDraft({ ...draft, [f.key]: Number(e.target.value) })
              }
              style={{ width: "100%" }}
            />
            <div style={{ fontSize: 11, color: "var(--mute)", marginTop: 2 }}>
              {f.hint}
            </div>
          </label>
        ))}
      </div>
      <div style={{ marginTop: 18, display: "flex", gap: 12, alignItems: "center" }}>
        <button onClick={save} disabled={saving || !dirty} className="btn">
          {saving ? "Saving" : "Save thresholds"}
        </button>
        {message && (
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--mute)", letterSpacing: "0.1em" }}
          >
            {message.toUpperCase()}
          </span>
        )}
      </div>
    </div>
  );
}
