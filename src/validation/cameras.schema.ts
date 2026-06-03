import { z } from 'zod';

const IP_REGEX =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d{1,3})\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d{1,3})$|^\[?[0-9a-fA-F:.]+\]?$/;

function isValidHostname(host: string): boolean {
  if (host.length > 253) return false;
  const labels = host.split('.');
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return false;
    if (!/^[a-zA-Z0-9-]+$/.test(label)) return false;
    if (label.startsWith('-') || label.endsWith('-')) return false;
  }
  return labels.length >= 1;
}

function isIpOrHostname(v: string): boolean {
  return IP_REGEX.test(v) || isValidHostname(v);
}

const optionalTrimmed = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null) return undefined;
    const t = v.trim();
    return t === '' ? undefined : t;
  });

export const CAMERA_TYPES = ['lpr', 'ptz', 'general'] as const;

export const CAMERA_DIRECTIONS = ['in', 'out'] as const;

export const cameraSchema = z.object({
  clientId: z.string().uuid('Cliente inválido.'),
  type: z.enum(CAMERA_TYPES, { message: 'Tipo de câmera inválido.' }),
  direction: z.enum(CAMERA_DIRECTIONS).optional().nullable(),
  brand: z
    .string()
    .trim()
    .min(1, 'Marca é obrigatória')
    .max(32, 'Marca muito longa')
    .transform((v) => v.toLowerCase()),
  name: z
    .string()
    .trim()
    .min(2, 'Nome deve ter pelo menos 2 caracteres')
    .max(255, 'Nome muito longo'),
  description: optionalTrimmed,
  ip: z
    .string()
    .trim()
    .min(1, 'IP ou hostname é obrigatório')
    .max(253, 'Endereço muito longo (máximo 253 caracteres).')
    .refine((v) => isIpOrHostname(v), {
      message: 'Informe um IP válido ou um hostname (DNS/DDNS).',
    }),
  port: z.coerce
    .number({ message: 'Porta inválida.' })
    .int()
    .min(1, 'Porta entre 1 e 65535')
    .max(65535, 'Porta entre 1 e 65535'),
  serialNumber: optionalTrimmed,
  model: optionalTrimmed,
  location: optionalTrimmed,
  deviceId: z
    .union([z.string().max(64, 'Device ID muito longo'), z.null()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === null) return undefined;
      const t = v.trim();
      return t === '' ? null : t;
    }),
  username: z
    .union([z.string().max(120, 'Usuário muito longo'), z.null()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === null) return undefined;
      const t = v.trim();
      return t === '' ? null : t;
    }),
  password: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === null) return undefined;
      if (typeof v !== 'string') return undefined;
      return v === '' ? undefined : v;
    })
    .refine((v) => v === undefined || (v.length >= 4 && v.length <= 256), {
      message: 'Senha deve ter entre 4 e 256 caracteres',
    }),
  isActive: z.boolean(),
});

export const createCameraSchema = cameraSchema.refine(
  (d) => !d.password || (d.username != null && d.username.trim().length > 0),
  {
    message: 'Informe o usuário da câmera para salvar a senha.',
    path: ['username'],
  },
);

export const updateCameraSchema = cameraSchema.partial();
