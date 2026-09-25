import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { cameras } from '../schema/cameras';
import {
  deviceSyncJobs,
  type DeviceSyncJobKind,
  type DeviceSyncJobRow,
  type DeviceSyncJobStatus,
} from '../schema/device-sync-jobs';
import { facialReaders } from '../schema/readers';

export type DeviceSyncJobListRow = DeviceSyncJobRow & {
  readerName: string | null;
  cameraName: string | null;
};

export async function listClientDeviceSyncJobs(
  db: AppDb,
  clientId: string,
  opts: {
    statuses?: DeviceSyncJobStatus[];
    kinds?: DeviceSyncJobKind[];
    limit: number;
    offset: number;
  },
): Promise<{ rows: DeviceSyncJobListRow[]; total: number }> {
  const filters = [eq(deviceSyncJobs.clientId, clientId)];
  if (opts.statuses?.length) {
    filters.push(inArray(deviceSyncJobs.status, opts.statuses));
  }
  if (opts.kinds?.length) {
    filters.push(inArray(deviceSyncJobs.kind, opts.kinds));
  }
  const where = and(...filters);

  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        job: deviceSyncJobs,
        readerName: facialReaders.name,
        cameraName: cameras.name,
      })
      .from(deviceSyncJobs)
      .leftJoin(
        facialReaders,
        and(
          eq(deviceSyncJobs.kind, 'face.reader'),
          eq(facialReaders.id, deviceSyncJobs.targetId),
        ),
      )
      .leftJoin(
        cameras,
        and(
          eq(deviceSyncJobs.kind, 'lpr.camera'),
          eq(cameras.id, deviceSyncJobs.targetId),
        ),
      )
      .where(where)
      .orderBy(
        sql`CASE ${deviceSyncJobs.status} WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END`,
        desc(deviceSyncJobs.createdAt),
      )
      .limit(opts.limit)
      .offset(opts.offset),
    db.select({ total: count() }).from(deviceSyncJobs).where(where),
  ]);

  return {
    rows: rows.map((r) => ({
      ...r.job,
      readerName: r.readerName,
      cameraName: r.cameraName,
    })),
    total: totalRow?.total ?? 0,
  };
}

export async function countClientDeviceSyncJobsByStatus(
  db: AppDb,
  clientId: string,
): Promise<Array<{ status: DeviceSyncJobStatus; total: number }>> {
  return db
    .select({ status: deviceSyncJobs.status, total: count() })
    .from(deviceSyncJobs)
    .where(eq(deviceSyncJobs.clientId, clientId))
    .groupBy(deviceSyncJobs.status);
}

/** Cancela jobs ainda na fila; sem `ids`, cancela toda a fila do cliente. */
export async function cancelQueuedDeviceSyncJobs(
  db: AppDb,
  clientId: string,
  ids?: string[],
): Promise<DeviceSyncJobRow[]> {
  const filters = [
    eq(deviceSyncJobs.clientId, clientId),
    eq(deviceSyncJobs.status, 'queued'),
  ];
  if (ids) filters.push(inArray(deviceSyncJobs.id, ids));
  return db
    .update(deviceSyncJobs)
    .set({
      status: 'canceled',
      error: 'Cancelado.',
      finishedAt: sql`NOW()`,
      updatedAt: sql`NOW()`,
    })
    .where(and(...filters))
    .returning();
}

/** Job em execução para no próximo ponto seguro (entre itens de um lote). */
export async function requestCancelRunningDeviceSyncJob(
  db: AppDb,
  clientId: string,
  id: string,
): Promise<boolean> {
  const rows = await db
    .update(deviceSyncJobs)
    .set({ cancelRequested: true, updatedAt: sql`NOW()` })
    .where(
      and(
        eq(deviceSyncJobs.id, id),
        eq(deviceSyncJobs.clientId, clientId),
        eq(deviceSyncJobs.status, 'running'),
      ),
    )
    .returning({ id: deviceSyncJobs.id });
  return rows.length > 0;
}
