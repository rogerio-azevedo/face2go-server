import { z } from 'zod';

import {
  createResponsibleSchema,
  linkResponsibleStudentSchema,
  responsibleRelationshipSchema,
} from './responsibles.schema';
import { normalizeVehiclePlate } from './vehicles.schema';

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

const managedResponsiblePersonSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome.').max(255),
  phone: z.string().trim().max(32).nullable().optional(),
  document: z.string().trim().max(32).nullable().optional(),
  isActive: z.boolean().optional().default(true),
  email: z.email('E-mail inválido.').nullable().optional(),
  password: z
    .string()
    .min(8, 'Senha deve ter pelo menos 8 caracteres.')
    .max(128)
    .nullable()
    .optional(),
  linkedResponsibleId: z.uuid().optional(),
});

export const createManagedResponsibleSchema = managedResponsiblePersonSchema
  .extend({
    students: z
      .array(managedResponsibleStudentLinkSchema)
      .min(1, 'Informe ao menos um aluno.'),
    imageBase64: z.string().min(64).optional(),
    vehicle: optionalVehicleSchema,
  })
  .superRefine((d, ctx) => {
    if (d.linkedResponsibleId) return;

    const hasEmail = Boolean(d.email?.trim());
    const hasPassword = Boolean(d.password && d.password.length >= 8);

    if (hasEmail !== hasPassword) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Para acesso ao aplicativo, informe e-mail e senha. Caso contrário, omita ambos.',
        path: ['email'],
      });
    }
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
