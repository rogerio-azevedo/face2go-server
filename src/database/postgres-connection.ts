import { Pool, type PoolConfig } from 'pg';

const DEFAULT_POOL_MAX = 10;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
const DEFAULT_END_TIMEOUT_MS = 5_000;

/**
 * Neon/alguns templates usam `?schema=public` na URI — o driver não trata esse
 * parâmetro como no libpq nativo e o RDS recusa (“unrecognized configuration parameter schema”).
 */
export function sanitizePostgresConnectionUrl(
  connectionString: string,
): string {
  try {
    const normalized = connectionString.replace(
      /^postgres:\/\//,
      'postgresql://',
    );
    const parsed = new URL(normalized);
    parsed.searchParams.delete('schema');

    const out = parsed.toString().replace(/^postgresql:/, 'postgres:');
    return out;
  } catch {
    return connectionString;
  }
}

/**
 * RDS / TLS: garante `sslmode=require` na URI quando solicitado pela env (ou já presente nos params).
 *
 * Drizzle Kit costuma ficar estável apenas com TLS na própria query string (`sslmode=require`),
 * em vez do objeto `ssl` separado em `dbCredentials`.
 */
export function finalizePostgresUrl(connectionString: string): string {
  const sanitized = sanitizePostgresConnectionUrl(connectionString);

  try {
    const normalized = sanitized.replace(/^postgres:\/\//, 'postgresql://');
    const parsed = new URL(normalized);
    const mode = parsed.searchParams.get('sslmode');
    const sslFromEnv =
      process.env.POSTGRES_SSL === 'require' ||
      process.env.POSTGRES_SSL === 'true';

    if (sslFromEnv && !mode) {
      parsed.searchParams.set('sslmode', 'require');
    }

    return parsed.toString().replace(/^postgresql:/, 'postgres:');
  } catch {
    return sanitized;
  }
}

/** Indica TLS obrigatório (URL já finalizada ou via env antes do finalize). */
export function shouldRequirePostgresSsl(connectionString: string): boolean {
  try {
    const sanitized = sanitizePostgresConnectionUrl(connectionString);
    const normalized = sanitized.replace(/^postgres:\/\//, 'postgresql://');
    const parsed = new URL(normalized);
    const mode = parsed.searchParams.get('sslmode');
    const sslFromQuery =
      mode === 'require' || mode === 'verify-ca' || mode === 'verify-full';
    const sslFromEnv =
      process.env.POSTGRES_SSL === 'require' ||
      process.env.POSTGRES_SSL === 'true';
    return sslFromQuery || sslFromEnv;
  } catch {
    return (
      process.env.POSTGRES_SSL === 'require' ||
      process.env.POSTGRES_SSL === 'true'
    );
  }
}

function readPositiveIntEnv(
  name: string,
  fallback: number,
  cap: number,
): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), cap);
}

function poolConfigFromEnv(connectionString: string): PoolConfig {
  const url = finalizePostgresUrl(connectionString);
  /** Redundância: alguns setups ignoram apenas `sslmode` na URI. */
  const ssl = shouldRequirePostgresSsl(connectionString)
    ? { rejectUnauthorized: false }
    : undefined;

  return {
    connectionString: url,
    max: readPositiveIntEnv('DATABASE_POOL_MAX', DEFAULT_POOL_MAX, 100),
    idleTimeoutMillis: readPositiveIntEnv(
      'DATABASE_POOL_IDLE_TIMEOUT_MS',
      DEFAULT_IDLE_TIMEOUT_MS,
      600_000,
    ),
    connectionTimeoutMillis: readPositiveIntEnv(
      'DATABASE_POOL_CONNECTION_TIMEOUT_MS',
      DEFAULT_CONNECTION_TIMEOUT_MS,
      60_000,
    ),
    ...(ssl ? { ssl } : {}),
  };
}

/** Pool `pg` com RDS / TLS compatível via URI finalizada. */
export function createPostgresClient(connectionString: string): Pool {
  return new Pool(poolConfigFromEnv(connectionString));
}

/** Fecha o pool; se travar, desiste após `timeoutMs` (equivalente ao `.end({ timeout })` do postgres.js). */
export async function endPostgresPool(
  pool: Pool,
  timeoutMs = DEFAULT_END_TIMEOUT_MS,
): Promise<void> {
  await Promise.race([
    pool.end(),
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }),
  ]);
}
