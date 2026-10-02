import { z } from 'zod';

export const clientTypeSchema = z.enum([
  'office',
  'clinic',
  'condominium',
  'school',
  'other',
]);

export const clientDashboardRecentAccessSchema = z.object({
  id: z.string(),
  personName: z.string().nullable(),
  readerName: z.string(),
  status: z.enum(['granted', 'denied']),
  createdAt: z.string(),
  readerDirection: z.enum(['in', 'out']).nullable(),
});

export const clientDashboardSchema = z.object({
  clientType: clientTypeSchema,
  timezoneOffsetMinutes: z.number().int(),
  registrations: z.object({
    pending: z.number().int(),
    approved: z.number().int(),
  }),
  activeRegistrationLinks: z.number().int(),
  people: z.object({
    members: z.number().int(),
    students: z.number().int(),
    responsibles: z.number().int(),
  }),
  schoolClasses: z.number().int(),
  vehicles: z.number().int(),
  cameras: z.number().int(),
  readers: z.object({
    total: z.number().int(),
    online: z.number().int(),
  }),
  accessesToday: z.object({
    granted: z.number().int(),
    denied: z.number().int(),
  }),
  recentAccesses: z.array(clientDashboardRecentAccessSchema),
});

export type ClientDashboard = z.infer<typeof clientDashboardSchema>;
