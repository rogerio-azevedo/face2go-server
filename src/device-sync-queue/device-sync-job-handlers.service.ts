import { Injectable, Logger } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import * as personReaderSyncQueries from '../database/queries/person-reader-sync.queries';
import * as vehicleCameraSyncQueries from '../database/queries/vehicle-camera-sync.queries';
import type { DeviceSyncJobRow } from '../database/schema/device-sync-jobs';
import { FaceReaderRebuildService } from '../face-sync/face-reader-rebuild.service';
import type { FaceSyncOutcome } from '../face-sync/face-sync.events';
import { FaceSyncService } from '../face-sync/face-sync.service';
import { LprPlateSyncService } from '../lpr-plate-sync/lpr-plate-sync.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { DeviceSyncPersistService } from './device-sync-persist.service';
import { DeviceSyncQueueService } from './device-sync-queue.service';
import type {
  FacePersonJobPayload,
  FaceReaderJobPayload,
  FaceSchoolJobPayload,
  LprCameraJobPayload,
  LprVehicleJobPayload,
} from './device-sync-queue.types';

export class JobCanceledError extends Error {
  constructor() {
    super('Cancelado.');
  }
}

export type JobContext = {
  /** Ponto seguro de cancelamento entre itens de um lote. */
  checkpoint(): Promise<void>;
};

@Injectable()
export class DeviceSyncJobHandlersService {
  private readonly log = new Logger(DeviceSyncJobHandlersService.name);

  constructor(
    private readonly queue: DeviceSyncQueueService,
    private readonly faceSync: FaceSyncService,
    private readonly rebuild: FaceReaderRebuildService,
    private readonly persist: DeviceSyncPersistService,
    private readonly lpr: LprPlateSyncService,
    private readonly r2: R2StorageService,
    private readonly database: DatabaseService,
  ) {}

  async run(job: DeviceSyncJobRow, ctx: JobContext): Promise<void> {
    switch (job.kind) {
      case 'face.person':
        return this.runFacePerson(job);
      case 'face.reader':
        return this.runFaceReader(job, ctx);
      case 'face.school':
        return this.runFaceSchool(job, ctx);
      case 'lpr.vehicle':
        return this.runLprVehicle(job);
      case 'lpr.camera':
        return this.runLprCamera(job, ctx);
      default:
        throw new Error(`kind desconhecido: ${String(job.kind)}`);
    }
  }

  /** Marca o cadastro como falho quando o job de face não conclui. */
  async persistFailedFacePerson(
    job: Pick<DeviceSyncJobRow, 'id' | 'kind' | 'clientId' | 'targetId'> & {
      payload: DeviceSyncJobRow['payload'];
    },
    message: string,
  ): Promise<void> {
    if (job.kind !== 'face.person') return;
    const payload = job.payload as FacePersonJobPayload;
    const outcome: FaceSyncOutcome = {
      deviceSyncStatus: 'sync_failed',
      deviceSyncError: message,
    };
    try {
      const hook = this.faceSync.takePersistHook(job.id);
      if (hook) await hook(outcome);
      else if (payload.entityKind) {
        await this.persist.persistFacePerson(
          job.clientId,
          job.targetId,
          payload,
          outcome,
        );
      }
    } catch (persistErr) {
      this.log.warn(
        `job=${job.id} persist sync_failed: ${persistErr instanceof Error ? persistErr.message : String(persistErr)}`,
      );
    }
  }

  private async runFacePerson(job: DeviceSyncJobRow): Promise<void> {
    const payload = job.payload as FacePersonJobPayload;
    if (!payload.photoKey || payload.faceId == null) {
      throw new Error('Job de face sem photoKey/faceId.');
    }
    const { buffer } = await this.r2.getObjectBytes(payload.photoKey);
    const outcome = await this.faceSync.syncPersonOnReaders({
      clientId: job.clientId,
      faceId: payload.faceId,
      name: payload.name || 'USUARIO',
      imageBuffer: buffer,
      photoKey: payload.photoKey,
      timeSectionIds: payload.timeSectionIds,
      logContext: payload.logContext,
      validFrom: payload.validFrom ? new Date(payload.validFrom) : undefined,
      validUntil: payload.validUntil ? new Date(payload.validUntil) : undefined,
      photoOnly: payload.photoOnly,
      blocked: payload.blocked,
      resetReaderProgress: payload.resetReaderProgress,
      allowSimilarFace: payload.allowSimilarFace,
      previousDeviceSyncError: payload.previousDeviceSyncError,
      readerIds: payload.readerIds,
    });
    await this.queue.update(job.id, { processed: 1, total: 1 });
    const hook = this.faceSync.takePersistHook(job.id);
    if (hook) await hook(outcome);
    else if (payload.entityKind) {
      await this.persist.persistFacePerson(
        job.clientId,
        job.targetId,
        payload,
        outcome,
      );
    }
  }

  private async runFaceReader(
    job: DeviceSyncJobRow,
    ctx: JobContext,
  ): Promise<void> {
    const payload = job.payload as FaceReaderJobPayload;
    const force = job.force || payload.force === true;
    const already = job.processed ?? 0;
    await this.faceSync.purgeIneligibleFacesFromReader(
      job.clientId,
      job.targetId,
    );
    if (force && already === 0) {
      await personReaderSyncQueries.deletePersonReaderSyncByReader(
        this.database.db,
        job.clientId,
        job.targetId,
      );
    }
    const people = await this.rebuild.listPeopleToSync(
      job.clientId,
      job.targetId,
      { skipSynced: true },
    );
    const total = already + people.length;
    await this.queue.update(job.id, { total, processed: already });
    let processed = already;
    for (const person of people) {
      await ctx.checkpoint();
      const { buffer } = await this.r2.getObjectBytes(person.photoKey);
      const outcome = await this.faceSync.syncPersonOnReaders({
        clientId: job.clientId,
        faceId: person.faceId,
        name: person.name,
        imageBuffer: buffer,
        photoKey: person.photoKey,
        timeSectionIds: person.timeSectionIds,
        validFrom: person.validFrom,
        validUntil: person.validUntil,
        blocked: person.blocked,
        logContext: `reader-rebuild=${job.targetId}:${person.id}`,
        readerIds: [job.targetId],
        resetReaderProgress: false,
      });
      await this.persist.persistFacePerson(
        job.clientId,
        person.id,
        {
          entityKind: person.entityKind,
          faceId: person.faceId,
          name: person.name,
          photoKey: person.photoKey,
        },
        outcome,
      );
      processed += 1;
      await this.queue.update(job.id, { processed, total });
    }
  }

  private async runFaceSchool(
    job: DeviceSyncJobRow,
    ctx: JobContext,
  ): Promise<void> {
    const payload = job.payload as FaceSchoolJobPayload;
    const entityKind = payload.entityKind;
    if (entityKind !== 'student' && entityKind !== 'responsible') {
      throw new Error('Job escolar sem entityKind.');
    }
    const already = job.processed ?? 0;
    const people = await this.rebuild.listSchoolBatchToSync(
      job.clientId,
      entityKind,
    );
    const total = already + people.length;
    await this.queue.update(job.id, { total, processed: already });
    let processed = already;
    for (const person of people) {
      await ctx.checkpoint();
      const { buffer } = await this.r2.getObjectBytes(person.photoKey);
      const outcome = await this.faceSync.syncPersonOnReaders({
        clientId: job.clientId,
        faceId: person.faceId,
        name: person.name,
        imageBuffer: buffer,
        photoKey: person.photoKey,
        timeSectionIds: person.timeSectionIds,
        blocked: person.blocked,
        logContext: `school-batch=${entityKind}:${person.id}`,
        resetReaderProgress: false,
      });
      await this.persist.persistFacePerson(
        job.clientId,
        person.id,
        {
          entityKind,
          faceId: person.faceId,
          name: person.name,
          photoKey: person.photoKey,
        },
        outcome,
      );
      processed += 1;
      await this.queue.update(job.id, { processed, total });
    }
  }

  private async runLprVehicle(job: DeviceSyncJobRow): Promise<void> {
    const payload = job.payload as LprVehicleJobPayload;
    const outcome = await this.lpr.syncVehiclePlateOnCameras({
      clientId: job.clientId,
      vehicleId: job.targetId,
      plate: payload.plate,
      ownerDisplayName: payload.ownerDisplayName,
      vehicleColor: payload.vehicleColor,
      logContext: payload.logContext,
      cameraIds: payload.cameraIds,
      resetCameraProgress: job.force,
    });
    await this.queue.update(job.id, { processed: 1, total: 1 });
    if (outcome.lprSyncStatus === 'sync_failed' && outcome.lprSyncError) {
      throw new Error(outcome.lprSyncError);
    }
  }

  private async runLprCamera(
    job: DeviceSyncJobRow,
    ctx: JobContext,
  ): Promise<void> {
    const payload = job.payload as LprCameraJobPayload;
    const force = job.force || payload.force === true;
    if (force) {
      await vehicleCameraSyncQueries.deleteVehicleCameraSyncByCamera(
        this.database.db,
        job.clientId,
        job.targetId,
      );
    }
    const synced = await this.lpr.syncAllVehiclesToCamera(
      job.clientId,
      job.targetId,
      { skipSynced: !force },
      async (processed, total) => {
        await this.queue.update(job.id, { processed, total });
        await ctx.checkpoint();
      },
    );
    await this.queue.update(job.id, {
      processed: synced.processed,
      total: synced.total,
    });
  }
}
