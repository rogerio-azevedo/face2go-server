import { z } from 'zod';

import { optionalBoolQuery } from './zod-utils';

const optionalDateQuery = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

const optionalUuidQuery = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined))
  .refine((value) => value == null || z.uuid().safeParse(value).success, {
    message: 'Identificador inválido.',
  });

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
  blockId: optionalUuidQuery,
  unitId: optionalUuidQuery,
  readerId: optionalTextQuery(64),
  onlyDenied: optionalBoolQuery,
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
