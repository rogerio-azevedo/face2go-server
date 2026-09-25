import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { z } from 'zod';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DatabaseService } from '../database/database.service';
import * as clientsQueries from '../database/queries/clients.queries';
import * as adminQueries from '../database/queries/device-sync-jobs-admin.queries';
import type {
  DeviceSyncJobRow,
  DeviceSyncJobStatus,
} from '../database/schema/device-sync-jobs';
import type {
  deviceSyncJobListItemSchema,
  deviceSyncJobListSchema,
  deviceSyncJobSummarySchema,
  listDeviceSyncJobsQuerySchema,
} from '../validation/device-sync-jobs.schema';
import { DeviceSyncPersistService } from './device-sync-persist.service';
import { DeviceSyncQueueService } from './device-sync-queue.service';
import type { FacePersonJobPayload } from './device-sync-queue.types';

type ListQuery = z.infer<typeof listDeviceSyncJobsQuerySchema>;
type ListItem = z.infer<typeof deviceSyncJobListItemSchema>;

const CANCELED_SYNC_ERROR = 'Sync cancelado.';

const SCHOOL_BATCH_LABEL: Record<string, string> = {
  student: 'Alunos',
  responsible: 'Responsáveis',
};

/** Gestão da fila de sync por cliente — somente `company_admin`. */
@Injectable()
export class DeviceSyncAdminService {
  constructor(
    private readonly database: DatabaseService,
    private readonly queue: DeviceSyncQueueService,
    private readonly persist: DeviceSyncPersistService,
  ) {}

  async list(
    user: JwtPayload,
    clientId: string,
    query: ListQuery,
  ): Promise<z.infer<typeof deviceSyncJobListSchema>> {
    await this.ensureClient(user, clientId);
    const statuses: DeviceSyncJobStatus[] | undefined =
      query.status === 'active'
        ? ['queued', 'running']
        : query.status
          ? [query.status]
          : undefined;
    const { rows, total } = await adminQueries.listClientDeviceSyncJobs(
      this.database.db,
      clientId,
      {
        statuses,
        kinds: query.kind ? [query.kind] : undefined,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      },
    );
    return {
      items: rows.map(toListItem),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async summary(
    user: JwtPayload,
    clientId: string,
  ): Promise<z.infer<typeof deviceSyncJobSummarySchema>> {
    await this.ensureClient(user, clientId);
    const counts = await adminQueries.countClientDeviceSyncJobsByStatus(
      this.database.db,
      clientId,
    );
    const summary = { queued: 0, running: 0, done: 0, failed: 0, canceled: 0 };
    for (const { status, total } of counts) summary[status] = total;
    return summary;
  }

  async cancel(
    user: JwtPayload,
    clientId: string,
    jobId: string,
  ): Promise<{ result: 'canceled' | 'cancel_requested' }> {
    await this.ensureClient(user, clientId);
    const job = await this.requireJob(clientId, jobId);
    if (job.status === 'queued') {
      const canceled = await adminQueries.cancelQueuedDeviceSyncJobs(
        this.database.db,
        clientId,
        [jobId],
      );
      if (canceled.length > 0) {
        await this.persistCanceled(canceled);
        return { result: 'canceled' };
      }
    }
    if (
      await adminQueries.requestCancelRunningDeviceSyncJob(
        this.database.db,
        clientId,
        jobId,
      )
    ) {
      return { result: 'cancel_requested' };
    }
    throw new BadRequestException('Este job já terminou.');
  }

  async cancelQueued(
    user: JwtPayload,
    clientId: string,
  ): Promise<{ canceled: number }> {
    await this.ensureClient(user, clientId);
    const canceled = await adminQueries.cancelQueuedDeviceSyncJobs(
      this.database.db,
      clientId,
    );
    await this.persistCanceled(canceled);
    return { canceled: canceled.length };
  }

  async retry(user: JwtPayload, clientId: string, jobId: string) {
    await this.ensureClient(user, clientId);
    const job = await this.requireJob(clientId, jobId);
    if (job.status !== 'failed' && job.status !== 'canceled') {
      throw new BadRequestException(
        'Só é possível reprocessar jobs com falha ou cancelados.',
      );
    }
    const next = await this.queue.enqueue({
      kind: job.kind,
      clientId,
      targetId: job.targetId,
      force: job.force,
      dedupeKey: job.dedupeKey,
      payload: job.payload,
      total: job.kind === 'face.person' || job.kind === 'lpr.vehicle' ? 1 : 0,
      createdBy: user.sub,
    });
    return this.queue.toDto(next);
  }

  /** Company users só leem jobs de clientes da própria empresa. */
  async ensureJobReadable(user: JwtPayload, clientId: string): Promise<void> {
    if (user.role === 'super_admin') return;
    if (user.role === 'client_admin' || user.role === 'client_operator') {
      if (user.clientId !== clientId) {
        throw new NotFoundException('Job não encontrado.');
      }
      return;
    }
    if (!user.companyId) throw new NotFoundException('Job não encontrado.');
    const client = await clientsQueries.getClientById(
      this.database.db,
      clientId,
      user.companyId,
    );
    if (!client) throw new NotFoundException('Job não encontrado.');
  }

  private async ensureClient(user: JwtPayload, clientId: string) {
    if (user.role !== 'company_admin' || !user.companyId) {
      throw new ForbiddenException('Sem permissão.');
    }
    const client = await clientsQueries.getClientById(
      this.database.db,
      clientId,
      user.companyId,
    );
    if (!client) throw new NotFoundException('Cliente não encontrado.');
  }

  private async requireJob(clientId: string, jobId: string) {
    const job = await this.queue.getById(jobId, clientId);
    if (!job) throw new NotFoundException('Job não encontrado.');
    return job;
  }

  /** Cadastro não pode ficar "pendente" para sempre depois de cancelado. */
  private async persistCanceled(rows: DeviceSyncJobRow[]): Promise<void> {
    for (const row of rows) {
      if (row.kind !== 'face.person') continue;
      const payload = row.payload as FacePersonJobPayload;
      if (!payload.entityKind) continue;
      await this.persist.persistFacePerson(
        row.clientId,
        row.targetId,
        payload,
        {
          deviceSyncStatus: 'sync_failed',
          deviceSyncError: CANCELED_SYNC_ERROR,
        },
      );
    }
  }
}

function toListItem(row: adminQueries.DeviceSyncJobListRow): ListItem {
  const payload = row.payload ?? {};
  const entityKind =
    typeof payload.entityKind === 'string' ? payload.entityKind : null;
  return {
    jobId: row.id,
    kind: row.kind,
    status: row.status,
    targetId: row.targetId,
    label: jobLabel(row, entityKind),
    entityKind,
    force: row.force,
    processed: row.processed,
    total: row.total,
    attempts: row.attempts,
    cancelRequested: row.cancelRequested,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

function jobLabel(
  row: adminQueries.DeviceSyncJobListRow,
  entityKind: string | null,
): string | null {
  const payload = row.payload ?? {};
  switch (row.kind) {
    case 'face.person':
      return typeof payload.name === 'string' ? payload.name : null;
    case 'lpr.vehicle':
      return typeof payload.plate === 'string' ? payload.plate : null;
    case 'face.reader':
      return row.readerName;
    case 'lpr.camera':
      return row.cameraName;
    case 'face.school':
      return entityKind ? (SCHOOL_BATCH_LABEL[entityKind] ?? null) : null;
    default:
      return null;
  }
}
