import { z } from 'zod';

const CNPJ_REGEX = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/;

const optionalTrimmed = z
  .string()
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    const t = v.trim();
    return t === '' ? undefined : t;
  });

export const CLIENT_TYPES = ['office', 'clinic', 'condominium', 'other'] as const;

export const clientSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Nome deve ter pelo menos 2 caracteres')
    .max(255, 'Nome muito longo'),
  type: z.enum(CLIENT_TYPES, {
    message: 'Selecione um tipo válido.',
  }),
  cnpj: optionalTrimmed.refine((val) => val === undefined || CNPJ_REGEX.test(val), {
    message: 'CNPJ inválido (use XX.XXX.XXX/XXXX-XX)',
  }),
  phone: optionalTrimmed,
  email: optionalTrimmed.refine(
    (val) => val === undefined || z.email().safeParse(val).success,
    { message: 'E-mail inválido' },
  ),
  logoUrl: optionalTrimmed.refine(
    (val) => val === undefined || /^https?:\/\/[^\s]+$/.test(val),
    {
      message:
        'Opcional — se preencher, use uma URL completa com http ou https.',
    },
  ),
  isActive: z.boolean(),
});

export const createClientSchema = clientSchema;

export const updateClientSchema = clientSchema.partial();
