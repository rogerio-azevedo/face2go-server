import { z } from 'zod';

import {
  createResponsibleSchema,
  linkResponsibleStudentSchema,
  responsibleRelationshipSchema,
} from './responsibles.schema';
import { createVehicleSchema, normalizeVehiclePlate } from './vehicles.schema';

const optionalVehicleSchema = z
  .object({
    plate: z.string(),
    brand: z.string().trim().min(1).max(100),
    model: z.string().trim().min(1).max(100),
    color: z.string().trim().min(1).max(50),
  })
  .transform((d) => ({
    plate: normalizeVehiclePlate(d.plate),
    brand: d.brand.trim(),
    model: d.model.trim(),
    color: d.color.trim(),
  }))
  .optional();

export const managedResponsibleStudentLinkSchema = linkResponsibleStudentSchema;

export const createManagedResponsibleSchema = createResponsibleSchema.extend({
  students: z
    .array(managedResponsibleStudentLinkSchema)
    .min(1, 'Informe ao menos um aluno.'),
  imageBase64: z.string().min(64).optional(),
  vehicle: optionalVehicleSchema,
});

export const createResponsibleInvitationSchema = z.object({
  students: z
    .array(managedResponsibleStudentLinkSchema)
    .min(1, 'Informe ao menos um aluno.'),
});

export const publicResponsibleRegisterSubmitSchema =
  createResponsibleSchema.extend({
    faceImageKey: z.string().min(1),
    vehicle: optionalVehicleSchema,
  });

export type CreateManagedResponsibleInput = z.infer<
  typeof createManagedResponsibleSchema
>;
export type CreateResponsibleInvitationInput = z.infer<
  typeof createResponsibleInvitationSchema
>;
export type PublicResponsibleRegisterSubmitInput = z.infer<
  typeof publicResponsibleRegisterSubmitSchema
>;

export { responsibleRelationshipSchema };
