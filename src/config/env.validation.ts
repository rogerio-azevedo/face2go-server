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
  /** Chave AES-256 para credenciais de leitores (64 hex = 32 bytes). */
  READER_ENCRYPTION_KEY: z
    .string()
    .regex(
      /^[0-9a-fA-F]{64}$/,
      'READER_ENCRYPTION_KEY deve ter exatamente 64 caracteres hexadecimais (32 bytes).',
    ),
  /** Códigos do eventManager Intelbras; padrão All. */
  FACIAL_EVENT_CODES: z.string().optional(),
  /** Log detalhado do stream (parse). Ex.: `1` para ativar. */
  FACIAL_STREAM_VERBOSE: z.string().optional(),
  /** Códigos do eventManager Intelbras para câmeras LPR; padrão All. */
  LPR_EVENT_CODES: z.string().optional(),
  /** Log detalhado do stream LPR. Ex.: `1` para ativar. */
  LPR_STREAM_VERBOSE: z.string().optional(),
  /** Log JSON no console (evento/raw + dedup) em cada ingestão LPR. Ex.: `1`. */
  LPR_DEBUG_RAW: z.string().optional(),
  /** Cloudflare R2 (upload de fotos no cadastro público). */
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1),
  CLOUDFLARE_R2_BUCKET: z.string().min(1),
  CLOUDFLARE_R2_ACCESS_KEY_ID: z.string().min(1),
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: z.string().min(1),
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
