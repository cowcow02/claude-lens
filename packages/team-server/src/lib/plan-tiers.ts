// Anthropic bills these subscriptions monthly. The published prices are the
// only dollar figures we can quote with confidence — Anthropic doesn't expose
// the underlying weekly compute budget that drives `seven_day.utilization`,
// so we surface % for capacity decisions and $/mo only for billing-grounded
// arithmetic (savings on downgrade, total team spend).
// Update when Anthropic changes pricing — `members.plan_tier` CHECK
// constraint in 0002_plan_utilization.sql must stay in sync with the keys here.
export const PLAN_TIERS = {
  pro: { label: "Claude Pro", monthlyPriceUsd: 20, rank: 0 },
  "pro-max": { label: "Claude Pro Max", monthlyPriceUsd: 100, rank: 1 },
  "pro-max-20x": { label: "Claude Pro Max 20x", monthlyPriceUsd: 200, rank: 2 },
  custom: { label: "Custom", monthlyPriceUsd: 0, rank: -1 },
} as const;

export type PlanTierKey = keyof typeof PLAN_TIERS;

export type PlanTierEntry = {
  key: PlanTierKey;
  label: string;
  monthlyPriceUsd: number;
  rank: number;
};

export const PLAN_TIERS_IN_ORDER: PlanTierEntry[] = (
  Object.keys(PLAN_TIERS) as PlanTierKey[]
)
  .filter((k) => PLAN_TIERS[k].rank >= 0)
  .sort((a, b) => PLAN_TIERS[a].rank - PLAN_TIERS[b].rank)
  .map((key) => ({ key, ...PLAN_TIERS[key] }));

export function tierEntry(key: string): PlanTierEntry {
  if (!(key in PLAN_TIERS)) {
    // Defensive: if a row in `memberships` slipped past the CHECK constraint
    // somehow (manual SQL update), fall back to `custom` so the optimizer
    // doesn't crash on the whole team.
    return { key: "custom", ...PLAN_TIERS.custom };
  }
  return { key: key as PlanTierKey, ...PLAN_TIERS[key as PlanTierKey] };
}

export function nextTierUp(key: PlanTierKey): PlanTierEntry | null {
  const entry = tierEntry(key);
  if (entry.rank < 0) return null; // custom tier has no automated upgrade
  return PLAN_TIERS_IN_ORDER.find((t) => t.rank === entry.rank + 1) ?? null;
}

export function nextTierDown(key: PlanTierKey): PlanTierEntry | null {
  const entry = tierEntry(key);
  if (entry.rank <= 0) return null;
  return PLAN_TIERS_IN_ORDER.find((t) => t.rank === entry.rank - 1) ?? null;
}
