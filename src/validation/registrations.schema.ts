import { z } from 'zod';

export const registrationStatusSchema = z.enum([
  'draft',
  'approved',
  'rejected',
]);

export const listRegistrationsQuerySchema = z.object({
  status: registrationStatusSchema.optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
  search: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export type ListRegistrationsQuery = z.infer<
  typeof listRegistrationsQuerySchema
>;
