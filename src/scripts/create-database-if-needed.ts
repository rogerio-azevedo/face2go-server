/**
 * Conecta no banco de manutenção (ex.: `postgres`) e cria o DB alvo da
 * DATABASE_URL caso não exista. Útil no primeiro provisionamento em RDS.
 */
import 'dotenv/config';

import {
  createPostgresClient,
  finalizePostgresUrl,
} from '../database/postgres-connection';

function normalizePostgresUri(raw: string): URL {
  return new URL(raw.replace(/^postgres:\/\//, 'postgresql://'));
}

function rewriteDatabaseName(rawUrl: string, databaseName: string): string {
  const u = normalizePostgresUri(rawUrl);
  u.pathname = `/${databaseName}`;
  const out = u.toString();
  return out.replace(/^postgresql:\/\//, 'postgres://');
}

async function databaseExists(
  adminSql: Awaited<ReturnType<typeof createPostgresClient>>,
  name: string,
) {
  const rows = await adminSql`
    SELECT 1 FROM pg_database WHERE datname = ${name} LIMIT 1
  `;
  return rows.length > 0;
}

async function main() {
  const url =
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL;

  if (!url) {
    throw new Error(
      'Defina DATABASE_URL (ou DATABASE_URL_UNPOOLED / POSTGRES_URL_NON_POOLING) no .env.',
    );
  }

  const urlSanitized = finalizePostgresUrl(url);

  const targetUrl = normalizePostgresUri(urlSanitized);
  const targetDb = decodeURIComponent(
    targetUrl.pathname.replace(/^\//, '') || '',
  ).replace(/^\/+/, '');

  if (!targetDb) {
    throw new Error(
      'DATABASE_URL deve incluir o nome do banco no path (/meu_db).',
    );
  }

  const maintenanceDb =
    process.env.POSTGRES_MAINTENANCE_DB?.trim() || 'postgres';

  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(targetDb)) {
    throw new Error(
      `Nome de banco só pode conter [a-zA-Z0-9_] (ajuste DATABASE_URL ou crie manualmente): ${targetDb}`,
    );
  }

  const adminConn = rewriteDatabaseName(urlSanitized, maintenanceDb);
  const adminSql = createPostgresClient(adminConn);

  try {
    const exists = await databaseExists(adminSql, targetDb);

    if (exists) {
      console.info(`Banco "${targetDb}" já existe.`);
      return;
    }

    await adminSql.unsafe(`CREATE DATABASE ${targetDb}`);
    console.info(`Banco "${targetDb}" criado (CREATE DATABASE).`);
  } finally {
    await adminSql.end({ timeout: 5 });
  }
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
