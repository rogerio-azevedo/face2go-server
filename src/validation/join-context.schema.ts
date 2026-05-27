import { z } from 'zod';

export const joinContextSchema = z.object({
  identifier: z.string().min(1, 'Informe e-mail ou CPF'),
  password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
  invite: z.string().min(4, 'Código de convite inválido'),
});

export type JoinContextInput = z.infer<typeof joinContextSchema>;
