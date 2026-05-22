import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';

import { ALL_FEATURES } from '../common/features.constants';
import { createPostgresClient } from '../database/postgres-connection';
import type { AppDb } from '../database/database.types';
import * as schema from '../database/schema';
import { seedLegalDocumentsIfNeeded } from './seed-legal-documents';

const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

async function seedFeaturesIfNeeded(db: AppDb) {
  for (const f of ALL_FEATURES) {
    const existing = await db
      .select({ id: schema.features.id })
      .from(schema.features)
      .where(eq(schema.features.slug, f.slug))
      .limit(1);

    if (existing.length > 0) continue;

    await db.insert(schema.features).values({
      slug: f.slug,
      name: f.name,
      description: f.description,
    });
  }
}

async function main() {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL ou POSTGRES_URL é obrigatório para o seed.');
  }

  const client = createPostgresClient(databaseUrl);

  try {
    const db = drizzle(client, { schema }) as AppDb;

    const email =
      process.env.SUPER_ADMIN_EMAIL ?? 'admin@face2go.local';
    const password =
      process.env.SUPER_ADMIN_PASSWORD ?? 'altere-esta-senha';

    const [existing] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    if (existing) {
      console.info(`Super admin já existe: ${email}`);
    } else {
      const hash = await bcrypt.hash(password, 12);

      await db.insert(schema.users).values({
        email,
        name: 'Super Admin',
        password: hash,
        role: 'super_admin',
        isActive: true,
      });

      console.info(`Super admin criado: ${email}`);
    }

    await seedFeaturesIfNeeded(db);
    console.info('Catálogo de features verificado.');

    await seedLegalDocumentsIfNeeded(db);
    console.info('Documentos legais verificados.');
  } finally {
    await client.end({ timeout: 5 });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
