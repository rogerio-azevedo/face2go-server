import { z } from 'zod';

export const listCompanyPresenceQuerySchema = z.object({
  clientId: z.string().uuid().optional(),
  status: z.enum(['in', 'out']).optional(),
});

export type ListCompanyPresenceQuery = z.infer<
  typeof listCompanyPresenceQuerySchema
>;

export const createEmergencyEventSchema = z.object({
  srpAction: z
    .enum(['hold', 'secure', 'lockdown', 'evacuate', 'shelter', 'other'])
    .optional(),
  reason: z.string().trim().max(500).optional(),
  panicEventId: z.string().trim().max(24).optional(),
});

export type CreateEmergencyEventInput = z.infer<
  typeof createEmergencyEventSchema
>;

export const updateEmergencyCheckinSchema = z.object({
  status: z.enum(['safe', 'not_located', 'evacuated', 'injured']),
  note: z.string().trim().max(500).optional(),
});

export type UpdateEmergencyCheckinInput = z.infer<
  typeof updateEmergencyCheckinSchema
>;

export const addEmergencyCheckinSchema = z.object({
  personType: z.enum(['student', 'responsible', 'member', 'guest']),
  personId: z.string().uuid(),
});

export type AddEmergencyCheckinInput = z.infer<
  typeof addEmergencyCheckinSchema
>;

export const resolveEmergencyEventSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

export type ResolveEmergencyEventInput = z.infer<
  typeof resolveEmergencyEventSchema
>;
