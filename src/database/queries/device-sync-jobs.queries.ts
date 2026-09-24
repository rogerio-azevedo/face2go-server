import { and, eq, inArray, sql } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import {
  deviceSyncJobs,
  type DeviceSyncJobKind,
  type DeviceSyncJobRow,
  type DeviceSyncJobStatus,
} from '../schema/device-sync-jobs';

export type { DeviceSyncJobRow };

export type EnqueueDeviceSyncJobInput = {
  kind: DeviceSyncJobKind;
  clientId: string;
  targetId: string;
  force?: boolean;
  dedupeKey: string;
  payload?: Record<string, unknown>;
  total?: number;
  createdBy?: string | null;
};

export async function findActiveJobByDedupe(db: AppDb, dedupeKey: string) {
  const [row] = await db
    .select()
    .from(deviceSyncJobs)
    .where(
      and(
        eq(deviceSyncJobs.dedupeKey, dedupeKey),
        inArray(deviceSyncJobs.status, ['queued', 'running']),
      ),
    )
    .orderBy(
      sql`CASE WHEN ${deviceSyncJobs.status} = 'queued' THEN 0 ELSE 1 END`,
    )
    .limit(1);
  return row ?? null;
}

/** Atualiza o job ainda na fila com o último estado pedido. */
export async function updateQueuedJobPayload(
  db: AppDb,
  id: string,
  patch: {
    payload: Record<string, unknown>;
    force: boolean;
    createdBy?: string | null;
  },
): Promise<DeviceSyncJobRow | null> {
  const [row] = await db
    .update(deviceSyncJobs)
    .set({
      payload: patch.payload,
      force: patch.force,
      ...(patch.createdBy !== undefined ? { createdBy: patch.createdBy } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(deviceSyncJobs.id, id), eq(deviceSyncJobs.status, 'queued')))
    .returning();
  return row ?? null;
}

export async function insertDeviceSyncJob(
  db: AppDb,
  input: EnqueueDeviceSyncJobInput,
): Promise<DeviceSyncJobRow> {
  const [row] = await db
    .insert(deviceSyncJobs)
    .values({
      kind: input.kind,
      clientId: input.clientId,
      targetId: input.targetId,
      force: input.force ?? false,
      dedupeKey: input.dedupeKey,
      payload: input.payload ?? {},
      total: input.total ?? 0,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  return row;
}

export async function getDeviceSyncJobById(
  db: AppDb,
  id: string,
  clientId?: string,
) {
  const filters = [eq(deviceSyncJobs.id, id)];
  if (clientId) filters.push(eq(deviceSyncJobs.clientId, clientId));
  const [row] = await db
    .select()
    .from(deviceSyncJobs)
    .where(and(...filters))
    .limit(1);
  return row ?? null;
}

export async function listDeviceSyncJobsByIds(db: AppDb, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(deviceSyncJobs)
    .where(inArray(deviceSyncJobs.id, ids));
}

export async function listActiveDeviceSyncJobs(
  db: AppDb,
  clientId: string,
  options?: { kinds?: DeviceSyncJobKind[] },
) {
  const filters = [
    eq(deviceSyncJobs.clientId, clientId),
    inArray(deviceSyncJobs.status, ['queued', 'running']),
  ];
  if (options?.kinds?.length) {
    filters.push(inArray(deviceSyncJobs.kind, options.kinds));
  }
  return db
    .select()
    .from(deviceSyncJobs)
    .where(and(...filters));
}

export async function requeueOrphanRunningJobs(db: AppDb): Promise<number> {
  const result = await db.execute(sql`
    WITH ranked AS (
      SELECT id,
             row_number() OVER (
               PARTITION BY dedupe_key
               ORDER BY started_at DESC NULLS LAST, created_at DESC
             ) AS rn,
             EXISTS (
               SELECT 1 FROM device_sync_jobs q
               WHERE q.dedupe_key = device_sync_jobs.dedupe_key
                 AND q.status = 'queued'
             ) AS has_queued
      FROM device_sync_jobs
      WHERE status = 'running'
    )
    UPDATE device_sync_jobs AS j
    SET status = CASE
          WHEN ranked.has_queued OR ranked.rn > 1 THEN 'failed'
          ELSE 'queued'
        END,
        error = CASE
          WHEN ranked.has_queued OR ranked.rn > 1
            THEN 'Substituído por um job mais recente.'
          ELSE j.error
        END,
        finished_at = CASE
          WHEN ranked.has_queued OR ranked.rn > 1 THEN NOW()
          ELSE j.finished_at
        END,
        updated_at = NOW()
    FROM ranked
    WHERE j.id = ranked.id
    RETURNING j.id
  `);
  const rows =
    (result as unknown as { rows?: Array<{ id: string }> }).rows ?? [];
  return rows.length;
}

export async function claimNextDeviceSyncJob(
  db: AppDb,
): Promise<DeviceSyncJobRow | null> {
  const result = await db.execute(sql`
    UPDATE device_sync_jobs AS j
    SET status = 'running',
        started_at = COALESCE(j.started_at, NOW()),
        updated_at = NOW()
    WHERE j.id = (
      SELECT q.id FROM device_sync_jobs q
      WHERE q.status = 'queued'
        AND NOT EXISTS (
          SELECT 1 FROM device_sync_jobs r
          WHERE r.kind = q.kind
            AND r.target_id = q.target_id
            AND r.id <> q.id
            AND (
              r.status = 'running'
              OR (r.status = 'queued' AND r.created_at < q.created_at)
            )
        )
      ORDER BY q.created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING j.id
  `);
  const rows =
    (result as unknown as { rows?: Array<{ id: string }> }).rows ?? [];
  const id = rows[0]?.id;
  if (!id) return null;
  return getDeviceSyncJobById(db, id);
}

export async function updateDeviceSyncJob(
  db: AppDb,
  id: string,
  patch: {
    status?: DeviceSyncJobStatus;
    processed?: number;
    total?: number;
    error?: string | null;
    finishedAt?: Date | null;
  },
) {
  await db
    .update(deviceSyncJobs)
    .set({
      ...patch,
      updatedAt: new Date(),
    })
    .where(eq(deviceSyncJobs.id, id));
}
