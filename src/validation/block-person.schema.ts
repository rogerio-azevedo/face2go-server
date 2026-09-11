import { z } from 'zod';

export const blockPersonSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, 'Informe o motivo do bloqueio (mín. 3 caracteres).')
    .max(2000),
});
