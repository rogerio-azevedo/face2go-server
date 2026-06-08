import { z } from 'zod';

export const responsibleRelationshipSchema = z.enum([
  'parent',
  'grandparent',
  'aunt_uncle',
  'sibling',
  'godparent',
  'guardian',
  'other',
]);

export const createResponsibleSchema = z.object({
  email: z.email('E-mail inválido.'),
  password: z
    .string()
    .min(8, 'Senha deve ter pelo menos 8 caracteres.')
    .max(128),
  name: z.string().trim().min(1, 'Informe o nome.').max(255),
  phone: z.string().trim().max(32).nullable().optional(),
  document: z.string().trim().max(32).nullable().optional(),
  isActive: z.boolean().optional().default(true),
});

export const updateResponsibleSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  email: z.email('E-mail inválido.').optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  document: z.string().trim().max(32).nullable().optional(),
  password: z
    .string()
    .min(8, 'Senha deve ter pelo menos 8 caracteres.')
    .max(128)
    .optional(),
  isActive: z.boolean().optional(),
});

export const linkResponsibleStudentSchema = z.object({
  studentId: z.uuid(),
  relationshipType: responsibleRelationshipSchema,
  isAuthorizedPickup: z.boolean().optional().default(true),
});

/** Body do PATCH vínculo: ao menos um campo deve ser enviado (validação no service). */
export const updateResponsibleStudentLinkSchema = z.object({
  relationshipType: responsibleRelationshipSchema.optional(),
  isAuthorizedPickup: z.boolean().optional(),
});
