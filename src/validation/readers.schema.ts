import { z } from 'zod';

const IP_REGEX =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d{1,3})\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d{1,3})$|^\[?[0-9a-fA-F:.]+\]?$/;

const optionalTrimmed = z
  .string()
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    const t = v.trim();
    return t === '' ? undefined : t;
  });

export const READER_BRANDS = ['intelbras', 'hikvision'] as const;

export const readerSchema = z.object({
  clientId: z.string().uuid('Cliente inválido.'),
  brand: z.enum(READER_BRANDS, { message: 'Marca inválida.' }),
  name: z
    .string()
    .trim()
    .min(2, 'Nome deve ter pelo menos 2 caracteres')
    .max(255, 'Nome muito longo'),
  description: optionalTrimmed,
  ip: z
    .string()
    .trim()
    .min(1, 'IP é obrigatório')
    .max(45, 'IP muito longo')
    .refine((v) => IP_REGEX.test(v), { message: 'IP inválido.' }),
  port: z.coerce
    .number({ message: 'Porta inválida.' })
    .int()
    .min(1, 'Porta entre 1 e 65535')
    .max(65535, 'Porta entre 1 e 65535'),
  serialNumber: optionalTrimmed,
  model: optionalTrimmed,
  location: optionalTrimmed,
  /** Login HTTP (Digest) no equipamento; opcional até configurar monitoramento. */
  username: z
    .string()
    .max(120, 'Usuário muito longo')
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const t = v.trim();
      return t === '' ? null : t;
    }),
  /** Texto puro no corpo da requisição; persistido criptografado no banco. */
  password: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      return v === '' ? undefined : v;
    })
    .refine((v) => v === undefined || (v.length >= 4 && v.length <= 256), {
      message: 'Senha deve ter entre 4 e 256 caracteres',
    }),
  isActive: z.boolean(),
});

export const createReaderSchema = readerSchema.refine(
  (d) => !d.password || (!!d.username && d.username.trim().length > 0),
  {
    message: 'Informe o usuário do leitor para salvar a senha.',
    path: ['username'],
  },
);

export const updateReaderSchema = readerSchema.partial();
