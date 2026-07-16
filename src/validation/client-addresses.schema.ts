import { z } from 'zod';

const cepRegex = /^\d{5}-?\d{3}$/;

export const GEOCODING_PROVIDERS = ['here', 'manual'] as const;
export const GEOCODING_PRECISIONS = [
  'rooftop',
  'street',
  'approximate',
] as const;

const addressFieldsSchema = z.object({
  label: z.string().trim().min(1).max(100).default('Principal'),
  isPrimary: z.boolean().optional(),
  cep: z
    .string()
    .trim()
    .regex(cepRegex, 'CEP inválido.')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v)),
  street: z.string().trim().max(255).optional(),
  number: z.string().trim().max(20).optional(),
  complement: z.string().trim().max(100).optional(),
  neighborhood: z.string().trim().max(100).optional(),
  city: z.string().trim().max(100).optional(),
  state: z
    .string()
    .trim()
    .length(2, 'UF deve ter 2 caracteres.')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v?.toUpperCase())),
  country: z.string().trim().length(2).default('BR'),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  geocodingProvider: z.enum(GEOCODING_PROVIDERS).default('manual'),
  geocodingPrecision: z.enum(GEOCODING_PRECISIONS).optional(),
  hereLocationId: z.string().trim().max(255).optional(),
});

export const createClientAddressSchema = addressFieldsSchema.superRefine(
  (data, ctx) => {
    const hasLat = data.latitude !== undefined;
    const hasLng = data.longitude !== undefined;
    if (hasLat !== hasLng) {
      ctx.addIssue({
        code: 'custom',
        message: 'Informe latitude e longitude juntas.',
        path: ['latitude'],
      });
    }
  },
);

export const updateClientAddressSchema = addressFieldsSchema
  .partial()
  .superRefine((data, ctx) => {
    const hasLat = data.latitude !== undefined;
    const hasLng = data.longitude !== undefined;
    if (hasLat !== hasLng) {
      ctx.addIssue({
        code: 'custom',
        message: 'Informe latitude e longitude juntas.',
        path: ['latitude'],
      });
    }
  });

export type CreateClientAddressInput = z.infer<
  typeof createClientAddressSchema
>;
export type UpdateClientAddressInput = z.infer<
  typeof updateClientAddressSchema
>;
