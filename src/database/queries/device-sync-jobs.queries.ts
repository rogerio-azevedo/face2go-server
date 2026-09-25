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

export type RecoverRunningScope =
  /** Jobs sem heartbeat há mais de N segundos, de qualquer instância. */
  | { staleSeconds: number }
  /** Jobs desta instância no shutdown: voltam sem gastar tentativa. */
  | { lockedBy: string };

export type RecoveredJob = { id: string; status: DeviceSyncJobStatus };

export const SUPERSEDED_JOB_ERROR = 'Substituído por um job mais recente.';

/**
 * Devolve para a fila jobs `running` cujo worker sumiu. Se já existe um job
 * `queued` com a mesma dedupe (índice único), o antigo vira `failed`.
 */
export async function recoverRunningJobs(
  db: AppDb,
  scope: RecoverRunningScope,
  maxAttempts: number,
): Promise<RecoveredJob[]> {
  const graceful = 'lockedBy' in scope;
  const scopeCondition = graceful
    ? sql`j.locked_by = ${scope.lockedBy}`
    : sql`COALESCE(j.heartbeat_at, j.updated_at) < NOW() - make_interval(secs => ${scope.staleSeconds})`;
  const exhausted = graceful ? sql`false` : sql`t.attempts >= ${maxAttempts}`;
  const refundAttempt = graceful ? sql`true` : sql`false`;
  const result = await db.execute(sql`
    WITH t AS (
      SELECT j.id, j.attempts, j.cancel_requested,
             row_number() OVER (
               PARTITION BY j.dedupe_key
               ORDER BY j.started_at DESC NULLS LAST, j.created_at DESC
             ) AS rn,
             EXISTS (
               SELECT 1 FROM device_sync_jobs q
               WHERE q.dedupe_key = j.dedupe_key AND q.status = 'queued'
             ) AS has_queued
      FROM device_sync_jobs j
      WHERE j.status = 'running' AND ${scopeCondition}
    ), d AS (
      SELECT t.id,
             CASE
               WHEN t.cancel_requested THEN 'canceled'
               WHEN t.has_queued OR t.rn > 1 THEN 'superseded'
               WHEN ${exhausted} THEN 'exhausted'
               ELSE 'requeue'
             END AS action
      FROM t
    )
    UPDATE device_sync_jobs AS j
    SET status = CAST(
          CASE d.action
            WHEN 'requeue' THEN 'queued'
            WHEN 'canceled' THEN 'canceled'
            ELSE 'failed'
          END AS device_sync_job_status),
        error = CASE d.action
          WHEN 'canceled' THEN 'Cancelado.'
          WHEN 'superseded' THEN ${SUPERSEDED_JOB_ERROR}
          WHEN 'exhausted' THEN ${`Worker parou de responder (${maxAttempts} tentativas).`}
          ELSE j.error
        END,
        finished_at = CASE WHEN d.action = 'requeue' THEN NULL ELSE NOW() END,
        attempts = CASE
          WHEN ${refundAttempt} AND d.action = 'requeue' THEN GREATEST(j.attempts - 1, 0)
          ELSE j.attempts
        END,
        locked_by = NULL,
        heartbeat_at = NULL,
        updated_at = NOW()
    FROM d
    WHERE j.id = d.id AND j.status = 'running'
    RETURNING j.id, j.status
  `);
  return (result as unknown as { rows?: RecoveredJob[] }).rows ?? [];
}

export async function claimNextDeviceSyncJob(
  db: AppDb,
  workerId: string,
): Promise<DeviceSyncJobRow | null> {
  const [row] = await db
    .update(deviceSyncJobs)
    .set({
      status: 'running',
      lockedBy: workerId,
      heartbeatAt: sql`NOW()`,
      attempts: sql`${deviceSyncJobs.attempts} + 1`,
      startedAt: sql`COALESCE(${deviceSyncJobs.startedAt}, NOW())`,
      updatedAt: sql`NOW()`,
    })
    .where(
      sql`${deviceSyncJobs.id} = (
        SELECT q.id FROM device_sync_jobs q
        WHERE q.status = 'queued'
          AND NOT EXISTS (
            SELECT 1 FROM device_sync_jobs r
            WHERE r.kind = q.kind
              AND r.target_id = q.target_id
              AND r.id <> q.id
              AND r.status IN ('queued', 'running')
              AND (r.status = 'running' OR r.created_at < q.created_at)
          )
        ORDER BY q.created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )`,
    )
    .returning();
  return row ?? null;
}

/** Renova o lease; `owned=false` quando o reaper já tirou o job desta instância. */
export async function heartbeatDeviceSyncJob(
  db: AppDb,
  id: string,
  workerId: string,
): Promise<{ owned: boolean; cancelRequested: boolean }> {
  const [row] = await db
    .update(deviceSyncJobs)
    .set({ heartbeatAt: sql`NOW()` })
    .where(
      and(
        eq(deviceSyncJobs.id, id),
        eq(deviceSyncJobs.status, 'running'),
        eq(deviceSyncJobs.lockedBy, workerId),
      ),
    )
    .returning({ cancelRequested: deviceSyncJobs.cancelRequested });
  return row
    ? { owned: true, cancelRequested: row.cancelRequested }
    : { owned: false, cancelRequested: false };
}

export async function isDeviceSyncJobCancelRequested(
  db: AppDb,
  id: string,
): Promise<boolean> {
  const [row] = await db
    .select({ cancelRequested: deviceSyncJobs.cancelRequested })
    .from(deviceSyncJobs)
    .where(eq(deviceSyncJobs.id, id))
    .limit(1);
  return row?.cancelRequested === true;
}

/** Estado final só vale se o job ainda é desta instância. */
export async function finishDeviceSyncJob(
  db: AppDb,
  id: string,
  workerId: string,
  patch: {
    status: Extract<DeviceSyncJobStatus, 'done' | 'failed' | 'canceled'>;
    error?: string | null;
  },
): Promise<boolean> {
  const rows = await db
    .update(deviceSyncJobs)
    .set({
      status: patch.status,
      error: patch.error ?? null,
      finishedAt: sql`NOW()`,
      lockedBy: null,
      heartbeatAt: null,
      updatedAt: sql`NOW()`,
    })
    .where(
      and(
        eq(deviceSyncJobs.id, id),
        eq(deviceSyncJobs.status, 'running'),
        eq(deviceSyncJobs.lockedBy, workerId),
      ),
    )
    .returning({ id: deviceSyncJobs.id });
  return rows.length > 0;
}

export async function purgeFinishedDeviceSyncJobs(
  db: AppDb,
  opts: { doneDays: number; failedDays: number; limit: number },
): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM device_sync_jobs
    WHERE id IN (
      SELECT id FROM device_sync_jobs
      WHERE (status = 'done'
             AND finished_at < NOW() - make_interval(days => ${opts.doneDays}))
         OR (status IN ('failed', 'canceled')
             AND finished_at < NOW() - make_interval(days => ${opts.failedDays}))
      LIMIT ${opts.limit}
    )
    RETURNING id
  `);
  return ((result as unknown as { rows?: unknown[] }).rows ?? []).length;
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
