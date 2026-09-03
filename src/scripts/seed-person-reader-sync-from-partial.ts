/**
 * Preenche person_reader_sync com leitores que já deram certo.
 * Não fala com Hikvision/Intelbras.
 *
 * - Cadastro fully synced → todos os leitores ativos como synced
 * - Parcial → leitores cujo nome NÃO aparece no erro
 *
 * Uso:
 *   pnpm db:seed-person-reader-sync -- --client-id=<uuid>
 *   pnpm db:seed-person-reader-sync -- --client-id=<uuid> --apply
 */
import 'dotenv/config';

import { and, eq, isNotNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

import {
  createPostgresClient,
  endPostgresPool,
} from '../database/postgres-connection';
import type { AppDb } from '../database/database.types';
import * as schema from '../database/schema';
import * as personReaderSyncQueries from '../database/queries/person-reader-sync.queries';
import * as readersQueries from '../database/queries/readers.queries';
import {
  isPartialSyncError,
  readerIdsToSeedAsSynced,
} from '../face-sync/person-reader-sync.util';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const clientIdArg = args
  .find((a) => a.startsWith('--client-id='))
  ?.split('=')[1];

type FaceRow = {
  kind: string;
  id: string;
  name: string | null;
  faceId: number;
  deviceSyncStatus: string | null;
  deviceSyncError: string | null;
};

function resolveSeedIds(
  row: FaceRow,
  readers: { id: string; name: string }[],
): { ids: string[]; reason: string } | null {
  if (row.deviceSyncStatus === 'synced' && row.deviceSyncError == null) {
    return { ids: readers.map((r) => r.id), reason: 'completo' };
  }
  if (isPartialSyncError(row.deviceSyncError) && row.deviceSyncError) {
    const ids = readerIdsToSeedAsSynced(row.deviceSyncError, readers);
    if (!ids) return null;
    return { ids, reason: `parcial (${ids.length}/${readers.length})` };
  }
  return null;
}

async function loadFaces(db: AppDb, clientId: string): Promise<FaceRow[]> {
  const [regs, students, responsibles] = await Promise.all([
    db
      .select({
        id: schema.registrations.id,
        name: schema.registrations.name,
        faceId: schema.registrations.faceId,
        deviceSyncStatus: schema.registrations.deviceSyncStatus,
        deviceSyncError: schema.registrations.deviceSyncError,
      })
      .from(schema.registrations)
      .where(
        and(
          eq(schema.registrations.clientId, clientId),
          eq(schema.registrations.status, 'approved'),
          isNotNull(schema.registrations.faceId),
        ),
      ),
    db
      .select({
        id: schema.students.id,
        name: schema.students.name,
        faceId: schema.students.faceId,
        deviceSyncStatus: schema.students.deviceSyncStatus,
        deviceSyncError: schema.students.deviceSyncError,
      })
      .from(schema.students)
      .where(
        and(
          eq(schema.students.clientId, clientId),
          isNotNull(schema.students.faceId),
        ),
      ),
    db
      .select({
        id: schema.responsibles.id,
        name: schema.responsibles.name,
        faceId: schema.responsibles.faceId,
        deviceSyncStatus: schema.responsibles.deviceSyncStatus,
        deviceSyncError: schema.responsibles.deviceSyncError,
      })
      .from(schema.responsibles)
      .where(
        and(
          eq(schema.responsibles.clientId, clientId),
          isNotNull(schema.responsibles.faceId),
        ),
      ),
  ]);

  const asRows = (
    kind: string,
    rows: {
      id: string;
      name: string | null;
      faceId: number | null;
      deviceSyncStatus: string | null;
      deviceSyncError: string | null;
    }[],
  ): FaceRow[] =>
    rows
      .filter((r): r is typeof r & { faceId: number } => r.faceId != null)
      .map((r) => ({ kind, ...r, faceId: r.faceId }));

  return [
    ...asRows('registration', regs),
    ...asRows('student', students),
    ...asRows('responsible', responsibles),
  ];
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!databaseUrl) {
    console.error('Defina DATABASE_URL no .env.');
    process.exit(1);
  }
  if (!clientIdArg) {
    console.error(
      'Informe --client-id=<uuid>. Ex.: pnpm db:seed-person-reader-sync -- --client-id=... --apply',
    );
    process.exit(1);
  }

  const sql = createPostgresClient(databaseUrl);
  const db = drizzle(sql, { schema }) as AppDb;

  try {
    const readers = await readersQueries.listReadersForFaceSyncByClient(
      db,
      clientIdArg,
    );
    if (readers.length === 0) {
      console.error('Nenhum leitor ativo com credenciais neste cliente.');
      process.exit(1);
    }

    console.log(
      `${apply ? 'APPLY' : 'DRY-RUN'} client=${clientIdArg} leitores=${readers.length}`,
    );
    console.log(readers.map((r) => `  - ${r.name}`).join('\n'));

    const faces = await loadFaces(db, clientIdArg);
    let seededFaces = 0;
    let seededRows = 0;
    let skippedExisting = 0;
    let skippedUnmatched = 0;

    for (const face of faces) {
      const existing = await personReaderSyncQueries.listPersonReaderSyncByFace(
        db,
        clientIdArg,
        face.faceId,
      );
      if (existing.length > 0) {
        skippedExisting += 1;
        continue;
      }

      const seed = resolveSeedIds(face, readers);
      if (!seed) {
        if (isPartialSyncError(face.deviceSyncError)) skippedUnmatched += 1;
        continue;
      }

      seededFaces += 1;
      seededRows += seed.ids.length;
      console.log(
        `  ${face.kind} ${face.name ?? face.id} face=${face.faceId} → ${seed.reason}`,
      );

      if (apply) {
        for (const readerId of seed.ids) {
          await personReaderSyncQueries.upsertPersonReaderSync(db, {
            clientId: clientIdArg,
            faceId: face.faceId,
            readerId,
            status: 'synced',
            error: null,
          });
        }
      }
    }

    console.log(
      `\nFaces: ${faces.length} · semear ${seededFaces} (${seededRows} linhas) · já tinham linhas ${skippedExisting} · parcial sem match ${skippedUnmatched}`,
    );
    if (!apply) {
      console.log('Nada gravado. Rode de novo com --apply para persistir.');
    }
  } finally {
    await endPostgresPool(sql);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
