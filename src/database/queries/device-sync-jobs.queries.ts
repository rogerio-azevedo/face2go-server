import { and, eq, inArray, sql } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import {
  deviceSyncJobs,
  type DeviceSyncJobKind,
  type DeviceSyncJobRow,
  type DeviceSyncJobStatus,
} from '../schema/device-sync-jobs';

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
    .limit(1);
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
    UPDATE device_sync_jobs
    SET status = 'queued',
        updated_at = NOW()
    WHERE status = 'running'
    RETURNING id
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
      SELECT id FROM device_sync_jobs
      WHERE status = 'queued'
      ORDER BY created_at ASC
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
