import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import * as jobQueries from '../database/queries/device-sync-jobs.queries';
import type { DeviceSyncJobKind } from '../database/schema/device-sync-jobs';
import type { DeviceSyncJobDto } from './device-sync-queue.types';

@Injectable()
export class DeviceSyncQueueService {
  constructor(private readonly database: DatabaseService) {}

  async enqueue(input: jobQueries.EnqueueDeviceSyncJobInput) {
    const existing = await jobQueries.findActiveJobByDedupe(
      this.database.db,
      input.dedupeKey,
    );
    if (existing?.status === 'queued') {
      const merged = await this.mergeQueued(existing, input);
      if (merged) return merged;
    }
    try {
      return await jobQueries.insertDeviceSyncJob(this.database.db, input);
    } catch {
      const raced = await jobQueries.findActiveJobByDedupe(
        this.database.db,
        input.dedupeKey,
      );
      if (raced?.status === 'queued') {
        const merged = await this.mergeQueued(raced, input);
        if (merged) return merged;
      }
      if (raced) return raced;
      throw new Error('Não foi possível enfileirar o sync.');
    }
  }

  /** Último estado vence enquanto o job ainda não começou. */
  private async mergeQueued(
    existing: jobQueries.DeviceSyncJobRow,
    input: jobQueries.EnqueueDeviceSyncJobInput,
  ) {
    return jobQueries.updateQueuedJobPayload(this.database.db, existing.id, {
      payload: input.payload ?? {},
      force: existing.force || input.force === true,
      createdBy: input.createdBy ?? existing.createdBy,
    });
  }

  toDto(row: {
    id: string;
    kind: DeviceSyncJobKind | string;
    status: string;
    force: boolean;
    targetId: string;
    processed: number;
    total: number;
    error: string | null;
    payload?: Record<string, unknown> | null;
  }): DeviceSyncJobDto {
    const entityKind =
      typeof row.payload?.entityKind === 'string'
        ? row.payload.entityKind
        : undefined;
    return {
      jobId: row.id,
      kind: row.kind,
      status: row.status,
      force: row.force,
      targetId: row.targetId,
      entityKind,
      processed: row.processed,
      total: row.total,
      error: row.error,
    };
  }

  getById(id: string, clientId?: string) {
    return jobQueries.getDeviceSyncJobById(this.database.db, id, clientId);
  }

  listActiveFaceReader(clientId: string) {
    return this.listActiveFace(clientId);
  }

  listActiveFace(clientId: string) {
    return jobQueries.listActiveDeviceSyncJobs(this.database.db, clientId, {
      kinds: ['face.person', 'face.reader', 'face.school'],
    });
  }

  listByIds(ids: string[]) {
    return jobQueries.listDeviceSyncJobsByIds(this.database.db, ids);
  }

  claimNext(workerId: string) {
    return jobQueries.claimNextDeviceSyncJob(this.database.db, workerId);
  }

  heartbeat(id: string, workerId: string) {
    return jobQueries.heartbeatDeviceSyncJob(this.database.db, id, workerId);
  }

  isCancelRequested(id: string) {
    return jobQueries.isDeviceSyncJobCancelRequested(this.database.db, id);
  }

  finish(
    id: string,
    workerId: string,
    patch: Parameters<typeof jobQueries.finishDeviceSyncJob>[3],
  ) {
    return jobQueries.finishDeviceSyncJob(
      this.database.db,
      id,
      workerId,
      patch,
    );
  }

  recoverRunning(scope: jobQueries.RecoverRunningScope, maxAttempts: number) {
    return jobQueries.recoverRunningJobs(this.database.db, scope, maxAttempts);
  }

  purgeFinished(
    opts: Parameters<typeof jobQueries.purgeFinishedDeviceSyncJobs>[1],
  ) {
    return jobQueries.purgeFinishedDeviceSyncJobs(this.database.db, opts);
  }

  update(
    id: string,
    patch: Parameters<typeof jobQueries.updateDeviceSyncJob>[2],
  ) {
    return jobQueries.updateDeviceSyncJob(this.database.db, id, patch);
  }
}
