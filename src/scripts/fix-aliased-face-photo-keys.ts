/**
 * Corrige photo_key aliasado: vínculo apontando para o arquivo R2 de outro id.
 *
 * - Mesma pessoa (mesmo user_id ou mesmo CPF): copia o objeto para o caminho
 *   canônico e atualiza só o photo_key.
 * - Pessoa diferente: zera face e apaga person_reader_sync se o face_id
 *   não for mais usado.
 * - Alvo inexistente: só reporta.
 *
 * Uso:
 *   pnpm db:fix-aliased-faces              # dry-run (padrão)
 *   pnpm db:fix-aliased-faces --apply
 */
import 'dotenv/config';

import { ConfigService } from '@nestjs/config';
import { and, eq, isNotNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

import {
  createPostgresClient,
  endPostgresPool,
} from '../database/postgres-connection';
import type { AppDb } from '../database/database.types';
import * as schema from '../database/schema';
import { storeReaderFaceVariants } from '../face-sync/face-image-variants';
import {
  canonicalFacePhotoKey,
  isPhotoKeyAliasedTo,
  parseBondPhotoKey,
} from '../people/face-photo-key';
import { R2StorageService } from '../storage/r2-storage.service';

const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const apply = process.argv.includes('--apply');

type BondKind = 'responsible' | 'member';

type AliasRow = {
  kind: BondKind;
  id: string;
  clientId: string;
  name: string;
  userId: string | null;
  document: string | null;
  photoKey: string;
  faceId: number | null;
};

type TargetBond = {
  id: string;
  name: string;
  userId: string | null;
  document: string | null;
};

function digits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

function isSamePerson(
  a: { userId: string | null; document: string | null },
  b: { userId: string | null; document: string | null },
): boolean {
  if (a.userId && b.userId && a.userId === b.userId) return true;
  const docA = digits(a.document);
  const docB = digits(b.document);
  return docA.length === 11 && docB.length === 11 && docA === docB;
}

async function loadAliasedRows(db: AppDb): Promise<AliasRow[]> {
  const [responsibleRows, memberRows] = await Promise.all([
    db
      .select({
        id: schema.responsibles.id,
        clientId: schema.responsibles.clientId,
        name: schema.responsibles.name,
        userId: schema.responsibles.userId,
        document: schema.responsibles.document,
        photoKey: schema.responsibles.photoKey,
        faceId: schema.responsibles.faceId,
      })
      .from(schema.responsibles)
      .where(isNotNull(schema.responsibles.photoKey)),
    db
      .select({
        id: schema.clientMembers.id,
        clientId: schema.clientMembers.clientId,
        name: schema.clientMembers.name,
        userId: schema.clientMembers.userId,
        document: schema.clientMembers.document,
        photoKey: schema.clientMembers.photoKey,
        faceId: schema.clientMembers.faceId,
      })
      .from(schema.clientMembers)
      .where(isNotNull(schema.clientMembers.photoKey)),
  ]);

  const mapped: AliasRow[] = [
    ...responsibleRows.map((row) => ({
      kind: 'responsible' as const,
      ...row,
      photoKey: row.photoKey as string,
    })),
    ...memberRows.map((row) => ({
      kind: 'member' as const,
      ...row,
      photoKey: row.photoKey as string,
    })),
  ];

  return mapped.filter((row) =>
    isPhotoKeyAliasedTo(row.photoKey, row.clientId, row.id),
  );
}

async function loadTarget(
  db: AppDb,
  parsed: NonNullable<ReturnType<typeof parseBondPhotoKey>>,
): Promise<TargetBond | null> {
  if (parsed.kind === 'responsible') {
    const [row] = await db
      .select({
        id: schema.responsibles.id,
        name: schema.responsibles.name,
        userId: schema.responsibles.userId,
        document: schema.responsibles.document,
      })
      .from(schema.responsibles)
      .where(eq(schema.responsibles.id, parsed.bondId))
      .limit(1);
    return row ?? null;
  }
  const [row] = await db
    .select({
      id: schema.clientMembers.id,
      name: schema.clientMembers.name,
      userId: schema.clientMembers.userId,
      document: schema.clientMembers.document,
    })
    .from(schema.clientMembers)
    .where(eq(schema.clientMembers.id, parsed.bondId))
    .limit(1);
  return row ?? null;
}

async function faceIdStillUsed(
  db: AppDb,
  clientId: string,
  faceId: number,
): Promise<boolean> {
  const [student, responsible, member] = await Promise.all([
    db
      .select({ id: schema.students.id })
      .from(schema.students)
      .where(
        and(
          eq(schema.students.clientId, clientId),
          eq(schema.students.faceId, faceId),
        ),
      )
      .limit(1),
    db
      .select({ id: schema.responsibles.id })
      .from(schema.responsibles)
      .where(
        and(
          eq(schema.responsibles.clientId, clientId),
          eq(schema.responsibles.faceId, faceId),
        ),
      )
      .limit(1),
    db
      .select({ id: schema.clientMembers.id })
      .from(schema.clientMembers)
      .where(
        and(
          eq(schema.clientMembers.clientId, clientId),
          eq(schema.clientMembers.faceId, faceId),
        ),
      )
      .limit(1),
  ]);
  return Boolean(student[0] || responsible[0] || member[0]);
}

async function copyToCanonical(
  db: AppDb,
  r2: R2StorageService | null,
  row: AliasRow,
  dryRun: boolean,
): Promise<void> {
  const dest = canonicalFacePhotoKey(row.clientId, {
    type: row.kind,
    id: row.id,
  });
  console.log(
    `  COPIAR (mesma pessoa): ${row.kind} ${row.name} (${row.id})\n` +
      `    ${row.photoKey}\n    → ${dest}`,
  );
  if (dryRun) return;
  if (!r2) {
    throw new Error('R2 não inicializado no modo --apply.');
  }

  const got = await r2.getObjectBytes(row.photoKey);
  await r2.putObject(dest, got.buffer, 'image/jpeg');
  await storeReaderFaceVariants(r2, dest, got.buffer);

  if (row.kind === 'responsible') {
    await db
      .update(schema.responsibles)
      .set({ photoKey: dest, updatedAt: new Date() })
      .where(eq(schema.responsibles.id, row.id));
    return;
  }
  await db
    .update(schema.clientMembers)
    .set({ photoKey: dest, updatedAt: new Date() })
    .where(eq(schema.clientMembers.id, row.id));
}

async function clearInheritedFace(
  db: AppDb,
  row: AliasRow,
  dryRun: boolean,
): Promise<void> {
  console.log(
    `  LIMPAR (pessoa diferente): ${row.kind} ${row.name} (${row.id}) ` +
      `faceId=${row.faceId ?? '—'} photo_key=${row.photoKey}`,
  );
  if (dryRun) return;

  if (row.kind === 'responsible') {
    await db
      .update(schema.responsibles)
      .set({
        photoKey: null,
        faceId: null,
        deviceSyncStatus: null,
        deviceSyncedAt: null,
        deviceSyncError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.responsibles.id, row.id));
  } else {
    await db
      .update(schema.clientMembers)
      .set({
        photoKey: null,
        faceId: null,
        deviceSyncStatus: null,
        deviceSyncedAt: null,
        deviceSyncError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.clientMembers.id, row.id));
  }

  if (row.faceId == null) return;
  const stillUsed = await faceIdStillUsed(db, row.clientId, row.faceId);
  if (!stillUsed) {
    await db
      .delete(schema.personReaderSync)
      .where(
        and(
          eq(schema.personReaderSync.clientId, row.clientId),
          eq(schema.personReaderSync.faceId, row.faceId),
        ),
      );
  }
}

async function main() {
  if (!databaseUrl) {
    console.error('Defina DATABASE_URL no .env.');
    process.exit(1);
  }

  const sql = createPostgresClient(databaseUrl);
  const db = drizzle(sql, { schema }) as AppDb;

  console.log(
    apply
      ? 'Modo --apply: alterações serão gravadas.\n'
      : 'Dry-run (nenhuma alteração). Passe --apply para gravar.\n',
  );

  const aliased = await loadAliasedRows(db);
  let copied = 0;
  let cleared = 0;
  let missing = 0;
  let failed = 0;

  const r2 = apply ? new R2StorageService(new ConfigService()) : null;

  for (const row of aliased) {
    const parsed = parseBondPhotoKey(row.photoKey);
    if (!parsed) continue;

    const target = await loadTarget(db, parsed);
    if (!target) {
      console.log(
        `  MANUAL: ${row.kind} ${row.name} (${row.id}) aponta para ${parsed.kind}=${parsed.bondId} inexistente`,
      );
      missing += 1;
      continue;
    }

    try {
      if (isSamePerson(row, target)) {
        await copyToCanonical(db, r2, row, !apply);
        copied += 1;
      } else {
        await clearInheritedFace(db, row, !apply);
        cleared += 1;
      }
    } catch (e: unknown) {
      failed += 1;
      console.error(
        `  ERRO em ${row.kind} ${row.name} (${row.id}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  console.log('\n--- Relatório ---');
  console.log(`Aliases encontrados: ${aliased.length}`);
  console.log(`Normalizados (mesma pessoa): ${copied}`);
  console.log(`Faces zeradas (pessoa diferente): ${cleared}`);
  console.log(`Alvo inexistente (manual): ${missing}`);
  console.log(`Falhas: ${failed}`);
  if (!apply) {
    console.log('\nNada foi gravado. Rode com --apply para aplicar.');
  }

  await endPostgresPool(sql);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
