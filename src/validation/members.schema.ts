import { z } from 'zod';

export const createClientRoleSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome.').max(100),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(
      /^[a-z0-9_-]+$/,
      'Slug deve conter apenas letras minúsculas, números, hífen ou underscore.',
    ),
  isActive: z.boolean().optional().default(true),
});

export const updateClientRoleSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9_-]+$/)
    .optional(),
  isActive: z.boolean().optional(),
});

export const createMemberSchema = z.object({
  roleId: z.uuid('Selecione a função.'),
  email: z.email('E-mail inválido.'),
  password: z
    .union([
      z.literal(''),
      z
        .string()
        .min(8, 'Senha deve ter pelo menos 8 caracteres.')
        .max(128),
    ])
    .optional(),
  name: z.string().trim().min(1, 'Informe o nome.').max(255),
  phone: z.string().trim().max(32).nullable().optional(),
  document: z.string().trim().max(32).nullable().optional(),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (YYYY-MM-DD).')
    .nullable()
    .optional(),
  isActive: z.boolean().optional().default(true),
});

export const updateMemberSchema = z.object({
  roleId: z.uuid().optional(),
  name: z.string().trim().min(1).max(255).optional(),
  email: z.email('E-mail inválido.').optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  document: z.string().trim().max(32).nullable().optional(),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  password: z
    .union([
      z.literal(''),
      z
        .string()
        .min(8, 'Senha deve ter pelo menos 8 caracteres.')
        .max(128),
    ])
    .optional(),
  isActive: z.boolean().optional(),
  canEnrollStudentFace: z.boolean().optional(),
});

export const createMemberVehicleSchema = z.object({
  plate: z.string().trim().min(7).max(10),
  brand: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(100),
  color: z.string().trim().min(1).max(50),
});

export const updateMemberVehicleSchema = createMemberVehicleSchema.partial();
