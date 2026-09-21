import { z } from 'zod';

const optionalDateQuery = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

const optionalTextQuery = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

export const clientAccessesListQuerySchema = z.object({
  startDate: optionalDateQuery,
  endDate: optionalDateQuery,
  page: z.coerce.number().int().min(1).optional(),
  name: optionalTextQuery(80),
  block: optionalTextQuery(50),
  unit: optionalTextQuery(50),
  readerId: optionalTextQuery(64),
});

export const companyAccessesListQuerySchema =
  clientAccessesListQuerySchema.extend({
    clientId: optionalTextQuery(64),
  });

export type ClientAccessesListQuery = z.infer<
  typeof clientAccessesListQuerySchema
>;

export type CompanyAccessesListQuery = z.infer<
  typeof companyAccessesListQuerySchema
>;
