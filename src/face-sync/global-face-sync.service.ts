import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { createReaderCredentialsCipher } from '../common/crypto/reader-credentials.cipher';
import type { EnvVars } from '../config/env.validation';
import { DatabaseService } from '../database/database.service';
import * as readersQueries from '../database/queries/readers.queries';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as studentClassesQueries from '../database/queries/student-classes.queries';
import * as studentsQueries from '../database/queries/students.queries';
import { SchoolAccessService } from '../school-access/school-access.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { AccessTimeZoneService } from './access-time-zone.service';
import { mapWithConcurrency } from '../common/concurrency/map-with-concurrency';
import { mapReadersWithSyncGate } from '../common/concurrency/reader-sync-gate';
import { loadOrCreateReaderFaceVariant } from './face-image-variants';
import { aggregateReaderSyncOutcome } from './aggregate-reader-sync-outcome.util';
import {
  batchUpsertUsersOnReader,
  type IntelbrasUserRecord,
} from './intelbras-device-bulk.client';
import {
  formatReaderFaceSyncError,
  intelbrasUpsertFaceOnReader,
  toPlainReaderCredential,
  type PlainReaderCredential,
} from './intelbras-device.client';
import { ALWAYS_TIME_ZONE_INDEX } from './intelbras-time-zone.constants';
import { syncLog, syncLogError } from './intelbras-sync-debug.util';

export type GlobalFaceSyncProgressEvent =
  | { type: 'start'; total: number }
  | {
      type: 'progress';
      entities: SyncEntity[];
      processed: number;
      synced: number;
      failed: number;
      total: number;
    }
  | { type: 'ping' }
  | { type: 'done'; synced: number; failed: number; total: number }
  | { type: 'error'; message: string };

type SyncEntity = {
  id: string;
  name: string;
  faceId: number;
  photoKey: string;
  zoneIndices: number[];
};

const BATCH_SIZE = 20;
const FACE_UPLOAD_CONCURRENCY = 3;
const SSE_PING_MS = 15_000;

@Injectable()
export class GlobalFaceSyncService {
  private readonly log = new Logger(GlobalFaceSyncService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly r2: R2StorageService,
    private readonly configService: ConfigService<EnvVars, true>,
    private readonly schoolAccess: SchoolAccessService,
    private readonly accessTimeZone: AccessTimeZoneService,
  ) {}

  async globalSyncStudents(
    user: JwtPayload,
    clientId: string,
    emit: (e: GlobalFaceSyncProgressEvent) => void,
  ): Promise<void> {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);

    const rows = await studentsQueries.listStudentsForGlobalSync(
      this.database.db,
      clientId,
    );
    const zonesByStudent =
      await studentClassesQueries.listActiveShiftZoneIndicesByStudentIds(
        this.database.db,
        rows.map((r) => r.id),
      );

    const entities: SyncEntity[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      faceId: r.faceId,
      photoKey: r.photoKey,
      zoneIndices: this.resolveTimeSections(zonesByStudent.get(r.id)),
    }));

    await this.runGlobalSync({
      clientId,
      entities,
      emit,
      updateStatus: (id, status) =>
        studentsQueries.updateStudentFace(
          this.database.db,
          id,
          clientId,
          status,
        ),
      logLabel: 'students',
    });
  }

  async globalSyncResponsibles(
    user: JwtPayload,
    clientId: string,
    emit: (e: GlobalFaceSyncProgressEvent) => void,
  ): Promise<void> {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);

    const rows = await responsiblesQueries.listResponsiblesForGlobalSync(
      this.database.db,
      clientId,
    );
    const zonesByResponsible =
      await responsiblesQueries.listActiveShiftZoneIndicesByResponsibleIds(
        this.database.db,
        rows.map((r) => r.id),
      );

    const entities: SyncEntity[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      faceId: r.faceId,
      photoKey: r.photoKey,
      zoneIndices: this.resolveTimeSections(zonesByResponsible.get(r.id)),
    }));

    await this.runGlobalSync({
      clientId,
      entities,
      emit,
      updateStatus: (id, status) =>
        responsiblesQueries.updateResponsibleFace(
          this.database.db,
          id,
          clientId,
          status,
        ),
      logLabel: 'responsibles',
    });
  }

  private resolveTimeSections(zoneIndices: number[] | undefined): number[] {
    const unique = [...new Set(zoneIndices ?? [])].filter(
      (z) => z !== ALWAYS_TIME_ZONE_INDEX,
    );
    if (unique.length === 0) return this.accessTimeZone.defaultTimeSections();
    return unique.sort((a, b) => a - b);
  }

  private async runGlobalSync(params: {
    clientId: string;
    entities: SyncEntity[];
    emit: (e: GlobalFaceSyncProgressEvent) => void;
    updateStatus: (
      id: string,
      patch: {
        deviceSyncStatus: 'synced' | 'sync_failed' | 'pending_sync';
        deviceSyncedAt: Date | null;
        deviceSyncError: string | null;
      },
    ) => Promise<unknown>;
    logLabel: string;
  }): Promise<void> {
    const { clientId, entities, emit, updateStatus, logLabel } = params;
    const total = entities.length;

    emit({ type: 'start', total });

    if (total === 0) {
      emit({ type: 'done', synced: 0, failed: 0, total: 0 });
      return;
    }

    const readers = await readersQueries.listReadersForFaceSyncByClient(
      this.database.db,
      clientId,
    );

    if (readers.length === 0) {
      emit({
        type: 'error',
        message: 'Nenhum leitor ativo com credenciais para este cliente.',
      });
      return;
    }

    const cipher = createReaderCredentialsCipher(
      this.configService.get('READER_ENCRYPTION_KEY', { infer: true }),
    );

    const plainReaders: PlainReaderCredential[] = readers.map((r) =>
      toPlainReaderCredential(r, cipher.decrypt(r.passwordEncrypted)),
    );

    const shiftsByZone =
      await this.accessTimeZone.loadShiftsByZoneIndex(clientId);

    const allZoneIndices = new Set<number>();
    for (const entity of entities) {
      for (const z of entity.zoneIndices) {
        if (z !== ALWAYS_TIME_ZONE_INDEX) allZoneIndices.add(z);
      }
    }

    syncLog('globalSync:ensureZones', {
      clientId,
      logLabel,
      readers: plainReaders.length,
      zones: [...allZoneIndices],
    });

    await mapReadersWithSyncGate(
      plainReaders,
      (reader) => reader.id,
      async (reader) => {
        try {
          await this.accessTimeZone.ensureZonesOnSingleReader(
            reader,
            [...allZoneIndices],
            shiftsByZone,
          );
        } catch (e) {
          this.log.warn(
            `Sync global ${logLabel}: falha ao garantir zonas no leitor ${reader.name}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      },
    );

    let processed = 0;
    let synced = 0;
    let failed = 0;

    const pingTimer = setInterval(() => emit({ type: 'ping' }), SSE_PING_MS);

    try {
      for (let i = 0; i < entities.length; i += BATCH_SIZE) {
        const batch = entities.slice(i, i + BATCH_SIZE);
        const photos = await this.loadPhotoBatch(batch);
        const intelbrasJpeg = await this.compressIntelbrasBatch(batch, photos);
        const failuresByEntity = new Map<string, string[]>();

        await mapReadersWithSyncGate(
          plainReaders,
          (reader) => reader.id,
          (reader) =>
            this.syncBatchOnReader(
              reader,
              batch,
              photos,
              intelbrasJpeg,
              failuresByEntity,
            ),
        );

        for (const entity of batch) {
          processed += 1;

          if (!photos.has(entity.id)) {
            failed += 1;
            await updateStatus(entity.id, {
              deviceSyncStatus: 'sync_failed',
              deviceSyncedAt: null,
              deviceSyncError: 'Não foi possível obter a foto armazenada.',
            });
            continue;
          }

          const readerFailures = failuresByEntity.get(entity.id) ?? [];
          const outcome = this.aggregateReaderOutcome(
            readerFailures,
            plainReaders.length,
          );

          if (outcome.deviceSyncStatus === 'synced') synced += 1;
          else failed += 1;

          await updateStatus(entity.id, {
            deviceSyncStatus: outcome.deviceSyncStatus,
            deviceSyncedAt:
              outcome.deviceSyncStatus === 'synced' ? new Date() : null,
            deviceSyncError: outcome.deviceSyncError,
          });
        }

        emit({ type: 'progress', entities, processed, synced, failed, total });
      }

      emit({ type: 'done', synced, failed, total });
    } catch (err) {
      syncLogError('globalSync', err, { clientId, logLabel });
      emit({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      clearInterval(pingTimer);
    }
  }

  private async syncBatchOnReader(
    reader: PlainReaderCredential,
    batch: SyncEntity[],
    photos: Map<string, Buffer>,
    intelbrasJpeg: Map<string, string>,
    failuresByEntity: Map<string, string[]>,
  ): Promise<void> {
    const eligible = batch.filter((e) => photos.has(e.id));
    if (eligible.length === 0) return;

    const userRecords: IntelbrasUserRecord[] = eligible.map((e) => ({
      userId: String(e.faceId),
      userName: e.name,
    }));

    try {
      await batchUpsertUsersOnReader(reader, userRecords);
    } catch (e) {
      this.log.warn(
        `Sync global: batch AccessUser falhou no leitor ${reader.name}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    await mapWithConcurrency(
      eligible,
      FACE_UPLOAD_CONCURRENCY,
      async (entity) => {
        const base64 = intelbrasJpeg.get(entity.id);
        if (!base64) return;
        try {
          await intelbrasUpsertFaceOnReader(
            reader,
            entity.faceId,
            entity.name,
            base64,
            entity.zoneIndices,
          );
        } catch (e) {
          const list = failuresByEntity.get(entity.id) ?? [];
          list.push(formatReaderFaceSyncError(reader.name, e));
          failuresByEntity.set(entity.id, list);
        }
      },
    );
  }

  private aggregateReaderOutcome(
    failures: string[],
    totalReaders: number,
  ): {
    deviceSyncStatus: 'synced' | 'sync_failed';
    deviceSyncError: string | null;
  } {
    return aggregateReaderSyncOutcome(failures, totalReaders);
  }

  private async compressIntelbrasBatch(
    batch: SyncEntity[],
    photos: Map<string, Buffer>,
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    await mapWithConcurrency(batch, FACE_UPLOAD_CONCURRENCY, async (entity) => {
      const photo = photos.get(entity.id);
      if (!photo) return;
      try {
        const buf = await loadOrCreateReaderFaceVariant(
          this.r2,
          entity.photoKey,
          photo,
          'intelbras',
        );
        result.set(entity.id, buf.toString('base64'));
      } catch (e) {
        syncLogError('globalSync:compressIntelbras', e, {
          entityId: entity.id,
          photoKey: entity.photoKey,
        });
      }
    });
    return result;
  }

  private async loadPhotoBatch(
    batch: SyncEntity[],
  ): Promise<Map<string, Buffer>> {
    const result = new Map<string, Buffer>();
    await Promise.all(
      batch.map(async (entity) => {
        try {
          const got = await this.r2.getObjectBytes(entity.photoKey);
          if (got.buffer.length >= 256) {
            result.set(entity.id, got.buffer);
          }
        } catch (e) {
          syncLogError('globalSync:loadPhoto', e, {
            entityId: entity.id,
            photoKey: entity.photoKey,
          });
        }
      }),
    );
    return result;
  }
}
