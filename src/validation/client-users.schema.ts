import { z } from 'zod';

export const patchClientUserRoleSchema = z.object({
  role: z.enum(['client_admin', 'client_operator']),
});

export const patchClientUserActiveSchema = z.object({
  isActive: z.boolean(),
});

export const patchClientUserProfileSchema = z.object({
  name: z.string().trim().min(2).max(255).optional(),
  email: z
    .string()
    .email('E-mail inválido.')
    .transform((value) => value.trim().toLowerCase())
    .optional(),
});

export const patchClientUserPasswordSchema = z.object({
  password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
});

export type PatchClientUserRoleInput = z.infer<
  typeof patchClientUserRoleSchema
>;
export type PatchClientUserActiveInput = z.infer<
  typeof patchClientUserActiveSchema
>;
export type PatchClientUserProfileInput = z.infer<
  typeof patchClientUserProfileSchema
>;
export type PatchClientUserPasswordInput = z.infer<
  typeof patchClientUserPasswordSchema
>;
