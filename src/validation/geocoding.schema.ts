import { z } from 'zod';

export const geocodingAutocompleteQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
  at: z
    .string()
    .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
    .optional(),
});

export const geocodingGeocodeQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
});

export const geocodingReverseQuerySchema = z.object({
  at: z.string().regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/),
});

export const geocodingLookupQuerySchema = z.object({
  id: z.string().trim().min(1).max(255),
});

export const normalizedGeocodingAddressSchema = z.object({
  cep: z.string().optional(),
  street: z.string().optional(),
  number: z.string().optional(),
  neighborhood: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
});

export const normalizedGeocodingResultSchema = z.object({
  id: z.string(),
  label: z.string(),
  address: normalizedGeocodingAddressSchema,
  latitude: z.number(),
  longitude: z.number(),
  precision: z.enum(['rooftop', 'street', 'approximate']).optional(),
});

export type NormalizedGeocodingResult = z.infer<
  typeof normalizedGeocodingResultSchema
>;
