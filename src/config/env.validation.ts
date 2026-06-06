import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_UNPOOLED: z.string().optional(),
  /** MongoDB (histórico de acessos faciais). */
  MONGODB_URI: z.string().min(1),
  /**
   * Nome lógico do banco no cluster (evita cair no banco `test` quando a URI
   * termina em `mongodb.net/?...` sem path).
   */
  MONGODB_DB_NAME: z.string().min(1).default('face2go'),
  JWT_SECRET: z.string().min(8),
  JWT_EXPIRES_IN: z.string().default('7d'),
  FRONTEND_URL: z.string().url(),
  PORT: z.coerce.number().default(3001),
  /** Quantidade máxima de zonas AccessTimeSchedule customizadas por leitor (exclui 255). */
  READER_MAX_TIME_ZONES: z.coerce.number().int().min(1).max(254).default(32),
  /** Chave AES-256 para credenciais de leitores (64 hex = 32 bytes). */
  READER_ENCRYPTION_KEY: z
    .string()
    .regex(
      /^[0-9a-fA-F]{64}$/,
      'READER_ENCRYPTION_KEY deve ter exatamente 64 caracteres hexadecimais (32 bytes).',
    ),
  /** Códigos do eventManager Intelbras para câmeras LPR; padrão All. */
  LPR_EVENT_CODES: z.string().optional(),
  /** Log detalhado do stream LPR. Ex.: `1` para ativar. */
  LPR_STREAM_VERBOSE: z.string().optional(),
  /** Log JSON no console (evento/raw + dedup) em cada ingestão LPR. Ex.: `1`. */
  LPR_DEBUG_RAW: z.string().optional(),
  /** Log estruturado de eventos LPR (snap + eventManager) para estudo de correlação. Ex.: `1`. */
  LPR_EVENT_LOG: z.string().optional(),
  /** Cloudflare R2 (upload de fotos no cadastro público). */
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1),
  CLOUDFLARE_R2_BUCKET: z.string().min(1),
  CLOUDFLARE_R2_ACCESS_KEY_ID: z.string().min(1),
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: z.string().min(1),
  /** Provedor de e-mail: smtp (Zoho) ou ses (AWS). Padrão: smtp. */
  EMAIL_PROVIDER: z.enum(['smtp', 'ses']).default('smtp'),
  /** SMTP (ex.: Zoho) — usado quando EMAIL_PROVIDER=smtp. Opcional em dev. */
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  SMTP_FROM_EMAIL: z.string().email().optional(),
  /** AWS SES — usado quando EMAIL_PROVIDER=ses. Opcional em dev. */
  AWS_REGION: z.string().min(1).optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  SES_FROM_EMAIL: z.string().email().optional(),
  /** API TOTVS IENH — integração de dados pessoais para controle de acesso. */
  IENH_API_URL: z.string().url().optional(),
  IENH_API_USER: z.string().min(1).optional(),
  IENH_API_PASSWORD: z.string().min(1).optional(),
});

export type EnvVars = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvVars {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(
      `Variáveis de ambiente inválidas: ${JSON.stringify(parsed.error.flatten(), null, 2)}`,
    );
  }
  return parsed.data;
}
