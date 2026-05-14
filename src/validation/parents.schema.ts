import { z } from 'zod';

export const parentRelationshipSchema = z.enum([
  'father',
  'mother',
  'grandfather',
  'grandmother',
  'guardian',
  'other',
]);

export const createParentSchema = z.object({
  email: z.email('E-mail inválido.'),
  password: z.string().min(8, 'Senha deve ter pelo menos 8 caracteres.').max(128),
  name: z.string().trim().min(1, 'Informe o nome.').max(255),
  phone: z.string().trim().max(32).nullable().optional(),
  document: z.string().trim().max(32).nullable().optional(),
  isActive: z.boolean().optional().default(true),
});

export const updateParentSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  document: z.string().trim().max(32).nullable().optional(),
  password: z
    .string()
    .min(8, 'Senha deve ter pelo menos 8 caracteres.')
    .max(128)
    .optional(),
  isActive: z.boolean().optional(),
});

export const linkParentStudentSchema = z.object({
  studentId: z.uuid(),
  relationshipType: parentRelationshipSchema,
  isAuthorizedPickup: z.boolean().optional().default(true),
});
