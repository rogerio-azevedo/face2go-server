import { z } from 'zod';

export const PANIC_EVENT_TYPES = ['panic'] as const;
export const PANIC_EVENT_STATUSES = ['open', 'claimed', 'closed'] as const;
export const PANIC_CLOSING_REASONS = [
  'resolved',
  'false_alarm',
  'duplicate',
  'other',
] as const;

export const createPanicEventSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  accuracy: z.coerce.number().min(0).optional(),
  deviceInfo: z
    .object({
      os: z.string().trim().max(50).optional(),
      appVersion: z.string().trim().max(20).optional(),
      brand: z.string().trim().max(50).optional(),
    })
    .optional(),
});

export const closePanicEventSchema = z.object({
  closingNotes: z.string().trim().max(2000).optional(),
  closingReason: z.enum(PANIC_CLOSING_REASONS),
});

export const listPanicEventsQuerySchema = z.object({
  status: z.enum(PANIC_EVENT_STATUSES).optional(),
  clientId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const updateClientPanicConfigSchema = z.object({
  enabled: z.boolean().optional(),
  allowedRoles: z.array(z.string().trim().min(1)).min(1).optional(),
  cooldownSeconds: z.coerce.number().int().min(10).max(3600).optional(),
});

export type CreatePanicEventInput = z.infer<typeof createPanicEventSchema>;
export type ClosePanicEventInput = z.infer<typeof closePanicEventSchema>;
export type ListPanicEventsQuery = z.infer<typeof listPanicEventsQuerySchema>;
export type UpdateClientPanicConfigInput = z.infer<
  typeof updateClientPanicConfigSchema
>;
