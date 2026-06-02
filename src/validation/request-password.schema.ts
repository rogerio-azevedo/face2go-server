import { z } from 'zod';

export const requestPasswordSchema = z.object({
  identifier: z
    .string()
    .min(1, 'Informe e-mail ou CPF')
    .refine(
      (value) => {
        const trimmed = value.trim();
        if (trimmed.includes('@')) {
          return z.string().email().safeParse(trimmed).success;
        }
        return trimmed.replace(/\D/g, '').length === 11;
      },
      { message: 'Informe um e-mail ou CPF válido' },
    ),
});

export type RequestPasswordInput = z.infer<typeof requestPasswordSchema>;
