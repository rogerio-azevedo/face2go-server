import { z } from 'zod';

const optionalDateQuery = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

export const clientAccessesListQuerySchema = z.object({
  startDate: optionalDateQuery,
  endDate: optionalDateQuery,
  page: z.coerce.number().int().min(1).optional(),
});

export type ClientAccessesListQuery = z.infer<
  typeof clientAccessesListQuerySchema
>;
