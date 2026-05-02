import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
  name: z
    .string()
    .trim()
    .min(2, 'Nome deve ter pelo menos 2 caracteres')
    .max(255, 'Nome muito longo'),
  phone: z
    .string()
    .trim()
    .min(8, 'Telefone inválido')
    .max(30, 'Telefone muito longo'),
  jobTitle: z
    .string()
    .trim()
    .min(2, 'Informe o cargo')
    .max(120, 'Cargo muito longo'),
  invite: z.string().min(4, 'Código de convite inválido'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
