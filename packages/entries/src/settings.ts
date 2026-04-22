export type AiFeaturesSettings = {
  enabled: boolean;
  apiKey: string;
  model: string;
  allowedProjects: string[];
  monthlyBudgetUsd: number | null;
};

export type Settings = {
  ai_features: AiFeaturesSettings;
};
