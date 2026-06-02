import { z } from 'zod';

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token inválido'),
  password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
