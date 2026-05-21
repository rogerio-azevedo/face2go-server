import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

import { finalizePostgresUrl } from './src/database/postgres-connection';

config({ path: '.env' });

const migrateUrlRaw =
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.DATABASE_URL!;

const migrateUrl = finalizePostgresUrl(migrateUrlRaw);

export default defineConfig({
  schema: './src/database/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: migrateUrl,
  },
});
