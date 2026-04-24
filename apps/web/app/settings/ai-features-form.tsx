"use client";
import { useState } from "react";

type Initial = {
  enabled: boolean;
  model: string;
  monthlyBudgetUsd: number | null;
};

export function AiFeaturesForm({
  initial, monthToDateSpend,
}: {
  initial: Initial;
  monthToDateSpend: number;
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [model, setModel] = useState(initial.model);
  const [budget, setBudget] = useState<string>(
    initial.monthlyBudgetUsd === null ? "" : String(initial.monthlyBudgetUsd),
  );
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSavedMsg(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ai_features: {
          enabled,
          model,
          monthlyBudgetUsd: budget === "" ? null : Number(budget),
        },
      }),
    });
    setSaving(false);
    setSavedMsg(res.ok ? "Saved." : `Error: ${res.status}`);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
        <span>Enable AI digests and enrichment</span>
      </label>

      <label className="block">
        <span className="text-sm text-gray-600">Model</span>
        <select
          value={model}
          onChange={e => setModel(e.target.value)}
          className="mt-1 block w-full border rounded px-2 py-1"
        >
          <option value="sonnet">sonnet (default)</option>
          <option value="opus">opus</option>
          <option value="haiku">haiku</option>
        </select>
        <span className="text-xs text-gray-500">
          Passed to <code>claude -p --model</code>; uses your existing Claude Code auth.
        </span>
      </label>

      <label className="block">
        <span className="text-sm text-gray-600">Monthly usage cap (USD reference) — blank = no cap</span>
        <input
          type="number"
          value={budget}
          onChange={e => setBudget(e.target.value)}
          step="0.01"
          className="mt-1 block w-full border rounded px-2 py-1"
        />
        <span className="text-xs text-gray-500">
          Reference-priced rate limit (you&apos;re billed via your Claude Code subscription, not per-token).
        </span>
      </label>

      <p className="text-xs text-gray-500">
        Month-to-date usage (reference): ${monthToDateSpend.toFixed(2)}
      </p>

      <button
        type="submit"
        disabled={saving}
        className="px-3 py-1 border rounded bg-black text-white disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save"}
      </button>
      {savedMsg && <p className="text-sm">{savedMsg}</p>}
    </form>
  );
}
