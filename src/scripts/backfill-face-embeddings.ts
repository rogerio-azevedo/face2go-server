/**
 * Gera os vetores das fotos que o cliente já tem, para nomear uma colisão
 * de face sem esperar o próximo sync.
 *
 * Uso:
 *   pnpm db:backfill-face-embeddings --client-id=<uuid>           # dry-run
 *   pnpm db:backfill-face-embeddings --all                        # dry-run
 *   pnpm db:backfill-face-embeddings --client-id=<uuid> --apply   # grava
 *   pnpm db:backfill-face-embeddings --all --apply
 */
import 'reflect-metadata';
import 'dotenv/config';

import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

import { validateEnv } from '../config/env.validation';
import type { AppDb } from '../database/database.types';
import {
  createPostgresClient,
  endPostgresPool,
} from '../database/postgres-connection';
import {
  listClientGalleryFaces,
  listEmbeddingsByClient,
} from '../database/queries/client-face-embeddings.queries';
import * as schema from '../database/schema';
import { DatabaseModule } from '../database/database.module';
import { FaceMatchModule } from '../face-match/face-match.module';
import { FaceMatchService } from '../face-match/face-match.service';
import { StorageModule } from '../storage/storage.module';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const allClients = args.includes('--all');
const clientIdArg = args
  .find((arg) => arg.startsWith('--client-id='))
  ?.split('=')[1];

function runningFromDist(): boolean {
  return __dirname.includes(`${join('dist', 'scripts')}`);
}

function reexecFromDistBuild(): void {
  console.log(
    'Modo --apply: compilando NestJS (tsx não preserva metadata de injeção)...\n',
  );
  execSync('pnpm build', { stdio: 'inherit', cwd: process.cwd() });
  const forwarded = process.argv
    .slice(2)
    .map((arg) => JSON.stringify(arg))
    .join(' ');
  execSync(
    `node -r reflect-metadata dist/scripts/backfill-face-embeddings.js ${forwarded}`,
    { stdio: 'inherit', cwd: process.cwd(), env: process.env },
  );
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DatabaseModule,
    StorageModule,
    FaceMatchModule,
  ],
})
class BackfillFaceEmbeddingsScriptModule {}

async function main() {
  if (!clientIdArg && !allClients) {
    console.error('Informe --client-id=<uuid> ou --all.');
    process.exit(1);
  }
  if (clientIdArg && allClients) {
    console.error('Use só --client-id ou só --all.');
    process.exit(1);
  }
  if (apply && !runningFromDist()) {
    reexecFromDistBuild();
    return;
  }

  const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!databaseUrl) {
    console.error('Defina DATABASE_URL no .env.');
    process.exit(1);
  }

  const sql = createPostgresClient(databaseUrl);
  const db = drizzle(sql, { schema }) as AppDb;
  const clients = clientIdArg
    ? await db
        .select({ id: schema.clients.id, name: schema.clients.name })
        .from(schema.clients)
        .where(eq(schema.clients.id, clientIdArg))
    : await db
        .select({ id: schema.clients.id, name: schema.clients.name })
        .from(schema.clients);

  if (clientIdArg && clients.length === 0) {
    console.error(`Cliente não encontrado: ${clientIdArg}`);
    await endPostgresPool(sql);
    process.exit(1);
  }

  console.log(
    apply
      ? 'Modo APPLY — embeddings serão gravados.\n'
      : 'Modo DRY-RUN — nada será gravado. Use --apply para executar.\n',
  );

  let nest: Awaited<
    ReturnType<typeof NestFactory.createApplicationContext>
  > | null = null;
  if (apply) {
    nest = await NestFactory.createApplicationContext(
      BackfillFaceEmbeddingsScriptModule,
      { logger: ['error', 'warn'] },
    );
  }
  const faceMatch = nest?.get(FaceMatchService);

  try {
    for (const client of clients) {
      const [faces, stored] = await Promise.all([
        listClientGalleryFaces(db, client.id),
        listEmbeddingsByClient(db, client.id),
      ]);
      const ready = new Set(
        stored.map((row) => `${row.faceId}:${row.photoKey}`),
      );
      const missing = faces.filter(
        (face) => !ready.has(`${face.faceId}:${face.photoKey}`),
      );
      console.log(
        `${client.name} (${client.id}): ${faces.length} foto(s), ${missing.length} sem vetor`,
      );
      if (!apply || !faceMatch) continue;
      const embedded = await faceMatch.ensureClientGallery(client.id);
      console.log(`  gravados na galeria: ${embedded}`);
    }
  } finally {
    if (nest) await nest.close();
    await endPostgresPool(sql);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
