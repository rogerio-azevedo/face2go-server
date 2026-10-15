import { z } from 'zod';

export const clientAlertsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
});

export const blockedAttemptItemSchema = z.object({
  id: z.string(),
  personName: z.string().nullable(),
  blockReason: z.string().nullable(),
  readerName: z.string(),
  readerDirection: z.enum(['in', 'out']).nullable(),
  eventDate: z.string().nullable(),
  createdAt: z.string(),
  clientName: z.string(),
  snapUrl: z.string().nullable(),
});

export const clientAlertsListSchema = z.object({
  items: z.array(blockedAttemptItemSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export type ClientAlertsListQuery = z.infer<typeof clientAlertsListQuerySchema>;
export type ClientAlertsList = z.infer<typeof clientAlertsListSchema>;
