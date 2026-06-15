/**
 * Variáveis mínimas para gerar OpenAPI sem Postgres/Mongo reais.
 * Usado por scripts/generate-openapi.ts e testes.
 */
const DUMMY_READER_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

export function applyOpenApiEnvDefaults(): void {
  process.env.DATABASE_URL ??=
    'postgresql://openapi:openapi@127.0.0.1:5432/openapi?connect_timeout=1';
  process.env.MONGODB_URI ??=
    'mongodb://127.0.0.1:27017/face2go?serverSelectionTimeoutMS=500&connectTimeoutMS=500';
  process.env.MONGODB_DB_NAME ??= 'face2go';
  process.env.JWT_SECRET ??= 'openapi-gen-secret-min-8-chars';
  process.env.JWT_EXPIRES_IN ??= '7d';
  process.env.FRONTEND_URL ??= 'http://localhost:3000';
  process.env.PORT ??= '6200';
  process.env.READER_ENCRYPTION_KEY ??= DUMMY_READER_KEY;
  process.env.CLOUDFLARE_ACCOUNT_ID ??= 'openapi-account-id';
  process.env.CLOUDFLARE_R2_BUCKET ??= 'openapi-bucket';
  process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ??= 'openapi-access-key';
  process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ??= 'openapi-secret-key';
  process.env.EMAIL_PROVIDER ??= 'smtp';
}
