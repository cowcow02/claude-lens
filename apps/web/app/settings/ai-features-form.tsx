"use client";
import { useState } from "react";

type Initial = {
  enabled: boolean;
  model: string;
  allowedProjects: string[];
  monthlyBudgetUsd: number | null;
};

export function AiFeaturesForm({
  initial, projectCandidates, monthToDateSpend,
}: {
  initial: Initial;
  projectCandidates: string[];
  monthToDateSpend: number;
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [model, setModel] = useState(initial.model);
  const [allowedProjects, setAllowedProjects] = useState<string[]>(initial.allowedProjects);
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
          allowedProjects,
          monthlyBudgetUsd: budget === "" ? null : Number(budget),
        },
      }),
    });
    setSaving(false);
    setSavedMsg(res.ok ? "Saved." : `Error: ${res.status}`);
  }

  function toggleProject(p: string) {
    setAllowedProjects(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p],
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
        <span>Enable Entry enrichment</span>
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

      <fieldset>
        <legend className="text-sm text-gray-600">Projects to enrich</legend>
        <div className="mt-1 space-y-1 max-h-48 overflow-auto border rounded p-2">
          {projectCandidates.length === 0 ? (
            <p className="text-xs text-gray-500">No projects detected yet — run the daemon at least once.</p>
          ) : projectCandidates.map(p => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allowedProjects.includes(p)}
                onChange={() => toggleProject(p)}
              />
              <code className="text-xs">{p}</code>
            </label>
          ))}
        </div>
      </fieldset>

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
