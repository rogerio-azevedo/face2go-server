import 'dotenv/config';

import { createPostgresClient } from '../database/postgres-connection';

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
    const tables = await sql`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('registration_links', 'registrations')
    ORDER BY tablename
  `;

    console.log(
      'Tabelas de cadastro:',
      tables.length > 0
        ? tables.map((r: { tablename: string }) => r.tablename).join(', ')
        : '(nenhuma — rode npm run db:migrate)',
    );

    const drizzleMeta = await sql`
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE tablename LIKE '%drizzle%migration%'
  `;
    if (drizzleMeta.length > 0) {
      console.log(
        'Metadado Drizzle:',
        drizzleMeta
          .map(
            (r: { schemaname: string; tablename: string }) =>
              `${r.schemaname}.${r.tablename}`,
          )
          .join(', '),
      );
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
