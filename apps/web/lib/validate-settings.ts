import { z } from "zod";

export const SettingsUpdateSchema = z.object({
  ai_features: z.object({
    enabled: z.boolean(),
  }),
});

export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>;
