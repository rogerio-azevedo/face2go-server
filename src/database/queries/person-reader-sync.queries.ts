import { and, eq, inArray, sql } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { personReaderSync } from '../schema';

export type PersonReaderSyncStatus = 'synced' | 'sync_failed';

/** Quantidade de leitores com status `synced` por faceId neste cliente. */
export async function countSyncedPersonReaderSyncByFaceIds(
  db: AppDb,
  clientId: string,
  faceIds: number[],
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (faceIds.length === 0) return map;
  const rows = await db
    .select({
      faceId: personReaderSync.faceId,
      count: sql<number>`count(*)::int`,
    })
    .from(personReaderSync)
    .where(
      and(
        eq(personReaderSync.clientId, clientId),
        inArray(personReaderSync.faceId, faceIds),
        eq(personReaderSync.status, 'synced'),
      ),
    )
    .groupBy(personReaderSync.faceId);
  for (const row of rows) {
    map.set(row.faceId, Number(row.count));
  }
  return map;
}

export async function listPersonReaderSyncByFace(
  db: AppDb,
  clientId: string,
  faceId: number,
) {
  return db
    .select({
      readerId: personReaderSync.readerId,
      status: personReaderSync.status,
      error: personReaderSync.error,
    })
    .from(personReaderSync)
    .where(
      and(
        eq(personReaderSync.clientId, clientId),
        eq(personReaderSync.faceId, faceId),
      ),
    );
}

export async function upsertPersonReaderSync(
  db: AppDb,
  input: {
    clientId: string;
    faceId: number;
    readerId: string;
    status: PersonReaderSyncStatus;
    error: string | null;
  },
) {
  const now = new Date();
  const syncedAt = input.status === 'synced' ? now : null;
  await db
    .insert(personReaderSync)
    .values({
      clientId: input.clientId,
      faceId: input.faceId,
      readerId: input.readerId,
      status: input.status,
      error: input.error,
      syncedAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        personReaderSync.clientId,
        personReaderSync.faceId,
        personReaderSync.readerId,
      ],
      set: {
        status: input.status,
        error: input.error,
        syncedAt,
        updatedAt: now,
      },
    });
}

export async function deletePersonReaderSyncByFace(
  db: AppDb,
  clientId: string,
  faceId: number,
) {
  await db
    .delete(personReaderSync)
    .where(
      and(
        eq(personReaderSync.clientId, clientId),
        eq(personReaderSync.faceId, faceId),
      ),
    );
}

export async function deletePersonReaderSyncByFaceAndReader(
  db: AppDb,
  clientId: string,
  faceId: number,
  readerId: string,
) {
  await db
    .delete(personReaderSync)
    .where(
      and(
        eq(personReaderSync.clientId, clientId),
        eq(personReaderSync.faceId, faceId),
        eq(personReaderSync.readerId, readerId),
      ),
    );
}

export async function listSyncedFaceIdsByReader(
  db: AppDb,
  clientId: string,
  readerId: string,
): Promise<Set<number>> {
  const rows = await db
    .select({ faceId: personReaderSync.faceId })
    .from(personReaderSync)
    .where(
      and(
        eq(personReaderSync.clientId, clientId),
        eq(personReaderSync.readerId, readerId),
        eq(personReaderSync.status, 'synced'),
      ),
    );
  return new Set(rows.map((row) => row.faceId));
}

export async function deletePersonReaderSyncByReader(
  db: AppDb,
  clientId: string,
  readerId: string,
) {
  await db
    .delete(personReaderSync)
    .where(
      and(
        eq(personReaderSync.clientId, clientId),
        eq(personReaderSync.readerId, readerId),
      ),
    );
}
