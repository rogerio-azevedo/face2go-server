import postgres from 'postgres';

/**
 * Neon/alguns templates usam `?schema=public` na URI — o postgres.js não trata esse
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

/** Cliente postgres.js com RDS / TLS compatível via URI finalizada. */
export function createPostgresClient(connectionString: string) {
  const url = finalizePostgresUrl(connectionString);
  /** Redundância: alguns setups ignoram apenas `sslmode` na URI. */
  const ssl = shouldRequirePostgresSsl(connectionString)
    ? ('require' as const)
    : undefined;

  return postgres(url, ssl ? { ssl } : {});
}
