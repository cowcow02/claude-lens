import { z } from "zod";

export const SettingsUpdateSchema = z.object({
  ai_features: z.object({
    enabled: z.boolean(),
    model: z.string().min(1),
    monthlyBudgetUsd: z.number().nonnegative().nullable(),
  }),
});

export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>;
