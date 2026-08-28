import { z } from 'zod';

export const enrollmentGroupSchema = z.enum(
  ['students', 'responsibles', 'members'],
  { message: 'Grupo inválido.' },
);

export type EnrollmentGroup = z.infer<typeof enrollmentGroupSchema>;

const optionalUuid = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined))
  .pipe(z.uuid().optional());

const optionalSearch = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => (value ? value : undefined));

export const enrollmentReportQuerySchema = z.object({
  group: enrollmentGroupSchema,
  classId: optionalUuid,
  search: optionalSearch,
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export type EnrollmentReportQuery = z.infer<typeof enrollmentReportQuerySchema>;

export const companyEnrollmentReportQuerySchema =
  enrollmentReportQuerySchema.extend({
    clientId: z.uuid('Cliente inválido.'),
  });

export type CompanyEnrollmentReportQuery = z.infer<
  typeof companyEnrollmentReportQuerySchema
>;

export const enrollmentSummarySchema = z.object({
  clientId: z.uuid(),
  clientName: z.string(),
  clientType: z.enum(['office', 'clinic', 'condominium', 'school', 'other']),
  group: enrollmentGroupSchema,
  total: z.number().int(),
  withFace: z.number().int(),
  withoutFace: z.number().int(),
  percentWithFace: z.number(),
  withVehicle: z.number().int().optional(),
  withoutVehicle: z.number().int().optional(),
  percentWithVehicle: z.number().optional(),
  classes: z.array(z.object({ id: z.uuid(), name: z.string() })).optional(),
});

export const enrollmentListItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  className: z.string().nullable().optional(),
  roleName: z.string().nullable().optional(),
  photoUrl: z.string().nullable().optional(),
  hasFace: z.boolean(),
  hasVehicle: z.boolean().optional(),
  deviceSyncStatus: z
    .enum(['pending_sync', 'synced', 'sync_failed'])
    .nullable(),
});
