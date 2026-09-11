import { z } from 'zod';

export const registrationStatusSchema = z.enum([
  'draft',
  'approved',
  'rejected',
]);

export const registrationListFilterSchema = z.enum([
  'draft',
  'approved',
  'rejected',
  'deleted',
]);

export const listRegistrationsQuerySchema = z.object({
  status: registrationListFilterSchema.optional(),
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

export const updateRegistrationSchema = z.object({
  name: z.string().trim().min(2).max(255),
  document: z.string().trim().min(5).max(32),
  phone: z.string().trim().min(8).max(32),
  email: z.string().email(),
  additionalData: z.record(z.string(), z.unknown()).optional(),
});

export type UpdateRegistrationInput = z.infer<typeof updateRegistrationSchema>;
