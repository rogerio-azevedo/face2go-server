import 'dotenv/config';

import {
  createPostgresClient,
  endPostgresPool,
} from '../database/postgres-connection';

/** Confere se a migration 0005 criou as tabelas esperadas (útil quando o log do migrate é silencioso). */
async function main() {
  const url =
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL;

  if (!url) {
    console.error('Defina DATABASE_URL (ou variante unpooled) no .env.');
    process.exit(1);
  }

  const sql = createPostgresClient(url);

  try {
    const tables = await sql.query<{ tablename: string }>(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('registration_links', 'registrations')
    ORDER BY tablename
  `);

    console.log(
      'Tabelas de cadastro:',
      tables.rows.length > 0
        ? tables.rows.map((r) => r.tablename).join(', ')
        : '(nenhuma — rode npm run db:migrate)',
    );

    const drizzleMeta = await sql.query<{
      schemaname: string;
      tablename: string;
    }>(`
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE tablename LIKE '%drizzle%migration%'
  `);
    if (drizzleMeta.rows.length > 0) {
      console.log(
        'Metadado Drizzle:',
        drizzleMeta.rows
          .map((r) => `${r.schemaname}.${r.tablename}`)
          .join(', '),
      );
    }
  } finally {
    await endPostgresPool(sql);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
