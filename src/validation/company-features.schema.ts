import { z } from 'zod';

export const toggleCompanyFeatureSchema = z.object({
  enabled: z.boolean(),
});

export type ToggleCompanyFeatureInput = z.infer<
  typeof toggleCompanyFeatureSchema
>;
