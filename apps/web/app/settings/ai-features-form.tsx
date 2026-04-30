"use client";
import { useState } from "react";

type Initial = {
  enabled: boolean;
};

export function AiFeaturesForm({ initial }: { initial: Initial }) {
  const [enabled, setEnabled] = useState(initial.enabled);
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
        ai_features: { enabled },
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
