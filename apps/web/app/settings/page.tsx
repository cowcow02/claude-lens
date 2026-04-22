import { readSettings, monthToDateSpend } from "@claude-lens/entries/node";
import { listKnownProjects } from "@claude-lens/entries/fs";
import { AiFeaturesForm } from "./ai-features-form";

export default function SettingsPage() {
  const s = readSettings();
  const spend = monthToDateSpend();
  // One pass over all Entries — O(n) at ~1000 entries is ~100ms.
  // Acceptable for V2 feature branch; revisit with a sidecar index if scale grows.
  const projects = listKnownProjects();
  return (
    <main className="mx-auto max-w-2xl p-6 space-y-8">
      <h1 className="text-2xl font-semibold">Fleetlens Settings</h1>
      <section>
        <h2 className="text-lg font-medium mb-2">AI Features</h2>
        <p className="text-sm text-gray-500 mb-4">
          When enabled, the daemon enriches each (session × day) Entry by spawning
          your local <code>claude</code> CLI (same auth as <code>/insights</code> —
          no API key required; uses your Claude Code subscription).
        </p>
        <AiFeaturesForm
          initial={{
            enabled: s.ai_features.enabled,
            model: s.ai_features.model,
            allowedProjects: s.ai_features.allowedProjects,
            monthlyBudgetUsd: s.ai_features.monthlyBudgetUsd,
          }}
          projectCandidates={projects}
          monthToDateSpend={spend}
        />
      </section>
    </main>
  );
}
