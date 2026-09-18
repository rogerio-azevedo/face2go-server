import { z } from 'zod';

import { isValidCpfOrCnpj, onlyDigits } from '../common/utils/document';

export const registrationStatusSchema = z.enum([
  'draft',
  'approved',
  'rejected',
  'blocked',
]);

export const registrationListFilterSchema = z.enum([
  'draft',
  'approved',
  'rejected',
  'blocked',
  'deleted',
]);

export const blockRegistrationSchema = z.object({
  reason: z.string().trim().min(3).max(2000),
});

const optionalLocationFilter = z
  .string()
  .trim()
  .max(50)
  .optional()
  .transform((value) => (value ? value : undefined));

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
  block: optionalLocationFilter,
  unit: optionalLocationFilter,
  room: optionalLocationFilter,
});

export type ListRegistrationsQuery = z.infer<
  typeof listRegistrationsQuerySchema
>;

const optionalBirthDate = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((value) => {
    if (value == null || value === '') return null;
    return value;
  })
  .refine((value) => value == null || /^\d{4}-\d{2}-\d{2}$/.test(value), {
    message: 'Data inválida (YYYY-MM-DD).',
  });

const optionalDocument = z
  .string()
  .trim()
  .max(32)
  .optional()
  .transform((value) => {
    if (value == null || value === '') return '';
    return onlyDigits(value);
  })
  .refine((value) => value === '' || isValidCpfOrCnpj(value), {
    message: 'CPF ou CNPJ inválido.',
  });

export const updateRegistrationSchema = z.object({
  name: z.string().trim().min(2).max(255),
  document: optionalDocument,
  phone: z.string().trim().max(32).optional(),
  email: z.string().trim().max(255).optional(),
  birthDate: optionalBirthDate,
  additionalData: z.record(z.string(), z.unknown()).optional(),
});

export const publicCheckDocumentSchema = z.object({
  document: z
    .string()
    .trim()
    .min(1, 'Informe o CPF ou CNPJ.')
    .max(32)
    .transform((value) => onlyDigits(value))
    .refine((value) => isValidCpfOrCnpj(value), {
      message: 'CPF ou CNPJ inválido.',
    }),
});

export const publicSubmitRegistrationSchema = z.object({
  registrationId: z.string().uuid(),
  name: z.string().min(2).max(255),
  document: optionalDocument,
  phone: z.string().max(32).optional(),
  email: z.string().max(255).optional(),
  birthDate: optionalBirthDate,
  faceImageKey: z.string().min(1),
  additionalData: z.record(z.string(), z.unknown()).optional(),
  truthDeclared: z.boolean().refine((v) => v === true, {
    message: 'É necessário confirmar a declaração de veracidade.',
  }),
});

export type UpdateRegistrationInput = z.infer<typeof updateRegistrationSchema>;
export type PublicSubmitRegistrationInput = z.infer<
  typeof publicSubmitRegistrationSchema
>;
