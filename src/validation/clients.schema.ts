import { z } from 'zod';

const CNPJ_REGEX = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/;
const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

const optionalTrimmed = z
  .string()
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    const t = v.trim();
    return t === '' ? undefined : t;
  });

/** Minutos relativos ao UTC; |valor inteiro| ≤ 14 vira horas (ex.: -4 → −240). */
export const TZ_OFFSET_ABS_MAX = 14 * 60;

export function normalizeClientTimezoneOffset(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '')
    throw new Error('INVALID_TZ_OFFSET');
  const n =
    typeof raw === 'number'
      ? raw
      : Number(String(raw).trim().replace(',', '.'));
  if (!Number.isFinite(n) || !Number.isInteger(n))
    throw new Error('INVALID_TZ_OFFSET');
  let m = n;
  if (Math.abs(m) <= 14) {
    m *= 60;
  }
  if (!Number.isInteger(m) || m < -TZ_OFFSET_ABS_MAX || m > TZ_OFFSET_ABS_MAX) {
    throw new Error('INVALID_TZ_OFFSET');
  }
  return m;
}

const baseClientShape = {
  name: z
    .string()
    .trim()
    .min(2, 'Nome deve ter pelo menos 2 caracteres')
    .max(255, 'Nome muito longo'),
  type: z.enum(
    ['office', 'clinic', 'condominium', 'school', 'other'] as const,
    {
      message: 'Selecione um tipo válido.',
    },
  ),
  cnpj: optionalTrimmed.refine(
    (val) => val === undefined || CNPJ_REGEX.test(val),
    {
      message: 'CNPJ inválido (use XX.XXX.XXX/XXXX-XX)',
    },
  ),
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
  primaryColor: optionalTrimmed.refine(
    (val) => val === undefined || HEX_COLOR_REGEX.test(val),
    {
      message: 'Opcional — use cor hexadecimal (#RRGGBB).',
    },
  ),
  privacyPolicyUrl: optionalTrimmed.refine(
    (val) => val === undefined || /^https?:\/\/[^\s]+$/.test(val),
    {
      message:
        'Opcional — se preencher, use uma URL completa com http ou https.',
    },
  ),
  isActive: z.boolean(),
};

/** Campo obrigatório no create (omissão/no branco ⇒ 0 = UTC). */
const timezoneOffsetCreate = z.preprocess((raw: unknown) => {
  try {
    if (raw === undefined || raw === null || raw === '') return 0;
    return normalizeClientTimezoneOffset(raw);
  } catch {
    return Number.NaN;
  }
}, z.number().int().min(-TZ_OFFSET_ABS_MAX).max(TZ_OFFSET_ABS_MAX));

/** No update, ausência do campo = não alterar. */
const timezoneOffsetUpdate = z.preprocess((raw: unknown) => {
  if (raw === undefined) return undefined;
  try {
    return normalizeClientTimezoneOffset(raw);
  } catch {
    return Number.NaN;
  }
}, z.number().int().min(-TZ_OFFSET_ABS_MAX).max(TZ_OFFSET_ABS_MAX).optional());

export const clientSchemaForCreate = z.object({
  ...baseClientShape,
  timezoneOffsetMinutes: timezoneOffsetCreate,
});

/** Alias do shape completo incluindo timezone (uso em formulários). */
export const clientSchema = clientSchemaForCreate;

export const createClientSchema = clientSchemaForCreate;

export const updateClientSchema = z
  .object({
    ...baseClientShape,
    timezoneOffsetMinutes: timezoneOffsetUpdate,
    ienhFilialCode: z
      .union([z.coerce.number().int().min(1).max(3), z.null()])
      .optional(),
  })
  .partial();
