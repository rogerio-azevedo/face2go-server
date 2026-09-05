import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

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
import { sleep } from './device-sync-sse.util';

const WORKER_CONCURRENCY = 2;
const POLL_IDLE_MS = 1500;

@Injectable()
export class DeviceSyncWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DeviceSyncWorkerService.name);
  private running = false;
  private loops: Promise<void>[] = [];

  constructor(
    private readonly queue: DeviceSyncQueueService,
    private readonly faceSync: FaceSyncService,
    private readonly rebuild: FaceReaderRebuildService,
    private readonly persist: DeviceSyncPersistService,
    private readonly lpr: LprPlateSyncService,
    private readonly r2: R2StorageService,
    private readonly database: DatabaseService,
  ) {}

  onModuleInit(): void {
    this.running = true;
    void this.recoverOrphans().then(() => {
      this.loops = Array.from({ length: WORKER_CONCURRENCY }, () =>
        this.loop(),
      );
    });
  }

  private async recoverOrphans(): Promise<void> {
    const n = await this.queue.requeueOrphans();
    if (n > 0) {
      this.log.warn(`recolocado(s) ${n} job(s) órfão(s) após restart`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    await Promise.all(this.loops);
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const job = await this.queue.claimNext();
        if (!job) {
          await sleep(POLL_IDLE_MS);
          continue;
        }
        await this.runJob(job);
      } catch (err) {
        this.log.warn(
          `worker: ${err instanceof Error ? err.message : String(err)}`,
        );
        await sleep(POLL_IDLE_MS);
      }
    }
  }

  private async runJob(job: DeviceSyncJobRow): Promise<void> {
    try {
      switch (job.kind) {
        case 'face.person':
          await this.runFacePerson(job);
          break;
        case 'face.reader':
          await this.runFaceReader(job);
          break;
        case 'face.school':
          await this.runFaceSchool(job);
          break;
        case 'lpr.vehicle':
          await this.runLprVehicle(job);
          break;
        case 'lpr.camera':
          await this.runLprCamera(job);
          break;
        default:
          throw new Error(`kind desconhecido: ${job.kind}`);
      }
      await this.queue.update(job.id, {
        status: 'done',
        finishedAt: new Date(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn(`job=${job.id} falhou: ${message}`);
      await this.queue.update(job.id, {
        status: 'failed',
        error: message,
        finishedAt: new Date(),
      });
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
      resetReaderProgress: payload.resetReaderProgress,
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

  private async runFaceReader(job: DeviceSyncJobRow): Promise<void> {
    const payload = job.payload as FaceReaderJobPayload;
    const force = job.force || payload.force === true;
    const already = job.processed ?? 0;
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

  private async runFaceSchool(job: DeviceSyncJobRow): Promise<void> {
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
      const { buffer } = await this.r2.getObjectBytes(person.photoKey);
      const outcome = await this.faceSync.syncPersonOnReaders({
        clientId: job.clientId,
        faceId: person.faceId,
        name: person.name,
        imageBuffer: buffer,
        photoKey: person.photoKey,
        timeSectionIds: person.timeSectionIds,
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

  private async runLprCamera(job: DeviceSyncJobRow): Promise<void> {
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
      },
    );
    await this.queue.update(job.id, {
      processed: synced.processed,
      total: synced.total,
    });
  }
}
