import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { mapReadersWithSyncGate } from '../common/concurrency/reader-sync-gate';
import { createReaderCredentialsCipher } from '../common/crypto/reader-credentials.cipher';
import type { EnvVars } from '../config/env.validation';
import { DatabaseService } from '../database/database.service';
import * as clientsQueries from '../database/queries/clients.queries';
import * as registrationsQueries from '../database/queries/registrations.queries';
import * as readersQueries from '../database/queries/readers.queries';
import * as personReaderSyncQueries from '../database/queries/person-reader-sync.queries';
import { PermissionsService } from '../permissions/permissions.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { imageBufferToReaderBase64Jpeg } from './face-image-for-reader';
import { loadOrCreateReaderFaceVariant } from './face-image-variants';
import {
  aggregateReaderSyncOutcome,
  isFullySyncedDevice,
} from './aggregate-reader-sync-outcome.util';
import type { FaceSyncOutcome, FaceSyncRequestedPayload } from './face-sync.events';
import { DeviceSyncQueueService } from '../device-sync-queue/device-sync-queue.service';
import type {
  FacePersonJobPayload,
  FaceSchoolJobPayload,
} from '../device-sync-queue/device-sync-queue.types';
import {
  formatReaderFaceSyncError,
  intelbrasRemoveUserFromReader,
  intelbrasUpsertFaceOnReader,
  toPlainReaderCredential,
} from './intelbras-device.client';
import { dateToIntelbrasFormat } from './intelbras-valid-date.util';
import { dateToHikvisionFormat } from '../integrations/hikvision/hikvision-valid-date.util';
import { normalizeHikvisionFaceJpeg } from './hikvision-face-image.util';
import {
  formatHikvisionFaceSyncError,
  hikvisionDeleteUser,
  hikvisionSyncFace,
  toHikvisionConnection,
} from '../integrations/hikvision';
import { ALWAYS_TIME_ZONE_INDEX } from './intelbras-time-zone.constants';
import { planPersonReaderSync } from './person-reader-sync.util';
import { AccessTimeZoneService } from './access-time-zone.service';
import {
  readerLabel,
  syncLog,
  syncLogError,
} from './intelbras-sync-debug.util';

export type FaceSyncProgressEvent =
  | { type: 'start'; total: number }
  | {
      type: 'item';
      registrationId: string;
      name: string | null;
      ok: boolean;
      error?: string;
    }
  | { type: 'ping' }
  | { type: 'done' }
  | { type: 'error'; message: string };

const SSE_PING_MS = 15_000;

@Injectable()
export class FaceSyncService {
  private readonly log = new Logger(FaceSyncService.name);
  private readonly persistHooks = new Map<
    string,
    (outcome: FaceSyncOutcome) => Promise<void>
  >();

  constructor(
    private readonly database: DatabaseService,
    private readonly r2: R2StorageService,
    private readonly configService: ConfigService<EnvVars, true>,
    private readonly permissionsService: PermissionsService,
    private readonly accessTimeZone: AccessTimeZoneService,
    private readonly queue: DeviceSyncQueueService,
  ) {}

  takePersistHook(jobId: string) {
    const hook = this.persistHooks.get(jobId);
    this.persistHooks.delete(jobId);
    return hook;
  }

  ensureCompanyCanAccessClientPublic(user: JwtPayload, clientId: string) {
    return this.ensureCompanyCanAccessClient(user, clientId);
  }

  ensureClientTenantPublic(user: JwtPayload): string {
    return this.ensureClientTenant(user);
  }

  private ensureCompany(user: JwtPayload): string {
    const companyId = user.companyId ?? undefined;
    if (!companyId) {
      throw new ForbiddenException('Sem permissão.');
    }
    return companyId;
  }

  private async ensureCompanyCanAccessClient(
    user: JwtPayload,
    clientId: string,
  ) {
    const companyId = this.ensureCompany(user);
    if (user.role === 'company_admin') {
      const client = await clientsQueries.getClientById(
        this.database.db,
        clientId,
        companyId,
      );
      if (!client) throw new NotFoundException('Cliente não encontrado.');
      return client;
    }
    if (user.role === 'company_operator') {
      const ok = await this.permissionsService.evaluateCompanyFeatureAction(
        user.role,
        user.companyUserId,
        'clients',
        'can_read',
      );
      if (!ok) {
        throw new ForbiddenException('Sem permissão.');
      }
      const client = await clientsQueries.getClientById(
        this.database.db,
        clientId,
        companyId,
      );
      if (!client) throw new NotFoundException('Cliente não encontrado.');
      return client;
    }
    throw new ForbiddenException('Sem permissão.');
  }

  private ensureClientTenant(user: JwtPayload): string {
    const clientId = user.clientId ?? undefined;
    if (
      !clientId ||
      (user.role !== 'client_admin' && user.role !== 'client_operator')
    ) {
      throw new ForbiddenException('Sem permissão.');
    }
    return clientId;
  }

  /** Indica se o cliente possui ao menos um leitor facial ativo com credenciais. */
  async hasActiveFacialReaders(clientId: string): Promise<boolean> {
    const readers = await readersQueries.listReadersForFaceSyncByClient(
      this.database.db,
      clientId,
    );
    return readers.length > 0;
  }

  /** Próximo ID por cliente (após aprovação com foto). */
  async assignFaceIdForClient(clientId: string): Promise<number> {
    return registrationsQueries.bumpClientFaceCounter(
      this.database.db,
      clientId,
    );
  }

  /**
   * Grava face_id e pending_sync no cadastro já aprovado.
   */
  async attachFaceIdToApprovedRegistration(
    registrationId: string,
    clientId: string,
    faceId: number,
  ): Promise<registrationsQueries.RegistrationRow> {
    const row = await registrationsQueries.setRegistrationFaceAfterApprove(
      this.database.db,
      registrationId,
      clientId,
      faceId,
    );
    if (!row) {
      throw new BadRequestException(
        'Cadastro não encontrado, não está aprovado ou face já atribuída.',
      );
    }
    return row;
  }

  async syncApprovedRegistrationForCompany(
    user: JwtPayload,
    clientId: string,
    registrationId: string,
  ) {
    await this.ensureCompanyCanAccessClient(user, clientId);
    return this.syncApprovedRegistration(registrationId, clientId);
  }

  async syncApprovedRegistrationForClientTenant(
    user: JwtPayload,
    registrationId: string,
  ) {
    const clientId = this.ensureClientTenant(user);
    return this.syncApprovedRegistration(registrationId, clientId);
  }

  /**
   * Envia a face aos leitores que ainda não estão synced.
   * O chamador atualiza o resumo `device_sync_*` da entidade.
   */
  async syncPersonOnReaders(params: {
    clientId: string;
    faceId: number;
    name: string;
    imageBuffer: Buffer;
    photoKey?: string;
    timeSectionIds?: number[];
    logContext?: string;
    validFrom?: Date;
    validUntil?: Date;
    photoOnly?: boolean;
    resetReaderProgress?: boolean;
    previousDeviceSyncError?: string | null;
    readerIds?: string[];
  }): Promise<{
    deviceSyncStatus: 'synced' | 'sync_failed';
    deviceSyncError: string | null;
  }> {
    const { clientId, faceId, name, imageBuffer, logContext, photoKey } =
      params;
    const photoOnly = params.photoOnly === true;
    const timeSectionIds =
      params.timeSectionIds && params.timeSectionIds.length > 0
        ? params.timeSectionIds
        : [ALWAYS_TIME_ZONE_INDEX];
    const logPrefix = logContext ? `${logContext} ` : '';
    const validDateStart = params.validFrom
      ? dateToIntelbrasFormat(params.validFrom)
      : undefined;
    const validDateEnd = params.validUntil
      ? dateToIntelbrasFormat(params.validUntil)
      : undefined;

    syncLog('syncPersonOnReaders:inicio', {
      clientId,
      faceId,
      name,
      timeSectionIds,
      validDateStart,
      validDateEnd,
      logContext: logPrefix.trim() || undefined,
      imageBytes: imageBuffer.length,
    });

    try {
      const allReaders = await readersQueries.listReadersForFaceSyncByClient(
        this.database.db,
        clientId,
      );
      const allowIds = params.readerIds?.filter((id) => id.trim());
      const readers =
        allowIds && allowIds.length > 0
          ? allReaders.filter((r) => allowIds.includes(r.id))
          : allReaders;

      syncLog('syncPersonOnReaders:leitores', {
        clientId,
        faceId,
        total: readers.length,
        readers: readers.map((r) => readerLabel(r)),
      });

      if (readers.length === 0) {
        syncLog('syncPersonOnReaders:semLeitores', { clientId, faceId });
        return {
          deviceSyncStatus: 'sync_failed',
          deviceSyncError:
            'Nenhum leitor ativo com credenciais para este cliente.',
        };
      }

      if (params.resetReaderProgress === true) {
        await personReaderSyncQueries.deletePersonReaderSyncByFace(
          this.database.db,
          clientId,
          faceId,
        );
      }

      const existingRows =
        await personReaderSyncQueries.listPersonReaderSyncByFace(
          this.database.db,
          clientId,
          faceId,
        );
      const plan = planPersonReaderSync(
        readers,
        existingRows,
        params.previousDeviceSyncError,
      );

      if (plan.seedSyncedIds.length > 0) {
        await Promise.all(
          plan.seedSyncedIds.map((readerId) =>
            personReaderSyncQueries.upsertPersonReaderSync(this.database.db, {
              clientId,
              faceId,
              readerId,
              status: 'synced',
              error: null,
            }),
          ),
        );
        syncLog('syncPersonOnReaders:seedParcial', {
          clientId,
          faceId,
          seeded: plan.seedSyncedIds.length,
          retry: plan.toSync.length,
        });
      }

      syncLog('syncPersonOnReaders:plano', {
        clientId,
        faceId,
        skipped: plan.skipped.length,
        toSync: plan.toSync.length,
      });

      const hasIntelbras = plan.toSync.some((r) => r.brand === 'intelbras');
      const hasHikvision = plan.toSync.some((r) => r.brand === 'hikvision');

      let intelbrasBase64: string | null = null;
      if (hasIntelbras) {
        try {
          syncLog('syncPersonOnReaders:compressImage', { clientId, faceId });
          const intelbrasBuf = photoKey
            ? await loadOrCreateReaderFaceVariant(
                this.r2,
                photoKey,
                imageBuffer,
                'intelbras',
              )
            : Buffer.from(
                await imageBufferToReaderBase64Jpeg(imageBuffer),
                'base64',
              );
          intelbrasBase64 = intelbrasBuf.toString('base64');
          syncLog('syncPersonOnReaders:compressImageOk', {
            clientId,
            faceId,
            base64Chars: intelbrasBase64.length,
          });
        } catch (e) {
          syncLogError('syncPersonOnReaders:compressImage', e, {
            clientId,
            faceId,
          });
          const msg =
            e instanceof Error ? e.message : 'Falha ao obter/comprimir a foto.';
          return { deviceSyncStatus: 'sync_failed', deviceSyncError: msg };
        }
      }

      let hikvisionJpeg: Buffer | null = null;
      if (hasHikvision) {
        try {
          syncLog('syncPersonOnReaders:hikvisionImage', {
            clientId,
            faceId,
            imageBytes: imageBuffer.length,
          });
          hikvisionJpeg = photoKey
            ? await loadOrCreateReaderFaceVariant(
                this.r2,
                photoKey,
                imageBuffer,
                'hikvision',
              )
            : await normalizeHikvisionFaceJpeg(imageBuffer);
        } catch (e) {
          syncLogError('syncPersonOnReaders:hikvisionImage', e, {
            clientId,
            faceId,
          });
          const msg =
            e instanceof Error ? e.message : 'Falha ao obter/comprimir a foto.';
          return { deviceSyncStatus: 'sync_failed', deviceSyncError: msg };
        }
      }

      const cipher = createReaderCredentialsCipher(
        this.configService.get('READER_ENCRYPTION_KEY', { infer: true }),
      );

      const shiftsByZone =
        await this.accessTimeZone.loadShiftsByZoneIndex(clientId);

      syncLog('syncPersonOnReaders:schedulesCarregados', {
        clientId,
        faceId,
        zonas: [...shiftsByZone.keys()],
        photoOnly,
      });

      const failures: string[] = [];

      const outcomes = await mapReadersWithSyncGate(
        plan.toSync,
        (r) => r.id,
        async (r) => {
          const label = readerLabel(r);
          try {
            syncLog('syncPersonOnReaders:leitorInicio', {
              clientId,
              faceId,
              reader: label,
              brand: r.brand,
              photoOnly,
            });
            const plain = toPlainReaderCredential(
              r,
              cipher.decrypt(r.passwordEncrypted),
            );

            if (r.brand === 'hikvision') {
              if (!hikvisionJpeg) {
                throw new Error(
                  'Falha ao preparar imagem para leitor Hikvision.',
                );
              }
              const connection = toHikvisionConnection(plain);
              await hikvisionSyncFace(connection, {
                employeeNo: String(faceId),
                personName: name || 'USUARIO',
                jpegBuffer: hikvisionJpeg,
                alreadyNormalized: true,
                validDateStart: params.validFrom
                  ? dateToHikvisionFormat(params.validFrom)
                  : undefined,
                validDateEnd: params.validUntil
                  ? dateToHikvisionFormat(params.validUntil)
                  : undefined,
              });
            } else {
              if (!intelbrasBase64) {
                throw new Error(
                  'Falha ao preparar imagem para leitor Intelbras.',
                );
              }

              if (!photoOnly) {
                await this.accessTimeZone.ensureZonesOnSingleReader(
                  plain,
                  timeSectionIds,
                  shiftsByZone,
                );
              }

              await intelbrasUpsertFaceOnReader(
                plain,
                faceId,
                name || 'USUARIO',
                intelbrasBase64,
                timeSectionIds,
                validDateStart,
                validDateEnd,
                { photoOnly },
              );
            }

            syncLog('syncPersonOnReaders:leitorOk', {
              clientId,
              faceId,
              reader: label,
            });
            return null;
          } catch (e) {
            const msg =
              r.brand === 'hikvision'
                ? formatHikvisionFaceSyncError(r.name, e)
                : formatReaderFaceSyncError(r.name, e);
            const raw =
              e instanceof Error
                ? e.message
                : typeof e === 'string'
                  ? e
                  : String(e);
            syncLogError('syncPersonOnReaders:leitor', e, {
              clientId,
              faceId,
              reader: label,
            });
            this.log.warn(`Sync face ${logPrefix}reader=${r.name}: ${raw}`);
            return msg;
          }
        },
      );

      for (const msg of outcomes) {
        if (msg !== null) failures.push(msg);
      }

      await Promise.all(
        plan.toSync.map((reader, index) => {
          const msg = outcomes[index] ?? null;
          return personReaderSyncQueries.upsertPersonReaderSync(
            this.database.db,
            {
              clientId,
              faceId,
              readerId: reader.id,
              status: msg === null ? 'synced' : 'sync_failed',
              error: msg,
            },
          );
        }),
      );

      const outcome = aggregateReaderSyncOutcome(failures, readers.length);

      if (outcome.deviceSyncStatus === 'sync_failed') {
        syncLog('syncPersonOnReaders:todosFalharam', {
          clientId,
          faceId,
          failures,
        });
        return outcome;
      }

      syncLog('syncPersonOnReaders:concluido', {
        clientId,
        faceId,
        synced: readers.length - failures.length,
        skipped: plan.skipped.length,
        total: readers.length,
        partial: failures.length > 0,
      });

      return outcome;
    } catch (err) {
      syncLogError('syncPersonOnReaders', err, { clientId, faceId });
      throw err;
    }
  }

  /** Remove face_id dos leitores ativos do cliente (exclusão de responsável). */
  async removePersonFromReaders(params: {
    clientId: string;
    faceId: number;
    logContext?: string;
    /** Quando true (padrão), falha se algum leitor não remover a face. */
    requireAll?: boolean;
  }): Promise<{ removed: number; total: number; failures: string[] }> {
    const { clientId, faceId, logContext, requireAll = true } = params;
    const readers = await readersQueries.listReadersForFaceSyncByClient(
      this.database.db,
      clientId,
    );
    if (readers.length === 0) {
      return { removed: 0, total: 0, failures: [] };
    }

    await personReaderSyncQueries.deletePersonReaderSyncByFace(
      this.database.db,
      clientId,
      faceId,
    );

    const cipher = createReaderCredentialsCipher(
      this.configService.get('READER_ENCRYPTION_KEY', { infer: true }),
    );
    const logPrefix = logContext ? `${logContext} ` : '';
    const failures: string[] = [];

    await Promise.all(
      readers.map(async (r) => {
        try {
          const plain = toPlainReaderCredential(
            r,
            cipher.decrypt(r.passwordEncrypted),
          );
          if (r.brand === 'hikvision') {
            const connection = toHikvisionConnection(plain);
            const result = await hikvisionDeleteUser(
              connection,
              String(faceId),
            );
            if (!result.success) {
              throw new Error(
                result.error ?? 'Falha ao remover usuário Hikvision',
              );
            }
          } else {
            await intelbrasRemoveUserFromReader(plain, faceId);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          failures.push(`${r.name}: ${msg}`);
          this.log.warn(
            `${logPrefix}Falha ao remover face ${faceId} do leitor ${r.name}: ${msg}`,
          );
        }
      }),
    );

    const result = {
      removed: readers.length - failures.length,
      total: readers.length,
      failures,
    };

    if (failures.length > 0 && requireAll) {
      throw new BadRequestException(
        `Não foi possível remover a face de todos os leitores (${failures.length} de ${readers.length} falhou). ${failures.join('; ')}`,
      );
    }

    return result;
  }

  /** Sincroniza um cadastro aprovado (foto no R2) com todos os leitores ativos do cliente. */
  async syncApprovedRegistration(
    registrationId: string,
    clientId: string,
  ): Promise<{
    deviceSyncStatus: 'synced' | 'sync_failed' | 'pending_sync';
    deviceSyncError: string | null;
  }> {
    const row = await registrationsQueries.getRegistrationByIdForClient(
      this.database.db,
      registrationId,
      clientId,
    );
    if (!row || row.status !== 'approved') {
      throw new NotFoundException(
        'Cadastro não encontrado ou não está aprovado.',
      );
    }
    if (!row.faceImageKey) {
      throw new BadRequestException('Cadastro sem foto.');
    }
    if (row.faceId == null) {
      throw new BadRequestException(
        'Cadastro sem face_id — reaprovar ou contactar suporte.',
      );
    }

    await registrationsQueries.updateRegistrationDeviceSync(
      this.database.db,
      registrationId,
      clientId,
      { deviceSyncStatus: 'pending_sync', deviceSyncedAt: null },
    );

    let buffer: Buffer;
    try {
      const got = await this.r2.getObjectBytes(row.faceImageKey);
      buffer = got.buffer;
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : 'Falha ao obter/comprimir a foto.';
      await registrationsQueries.updateRegistrationDeviceSync(
        this.database.db,
        registrationId,
        clientId,
        { deviceSyncStatus: 'sync_failed', deviceSyncError: msg },
      );
      return { deviceSyncStatus: 'sync_failed', deviceSyncError: msg };
    }

    const { deviceSyncStatus, deviceSyncError } =
      await this.syncPersonOnReaders({
        clientId,
        faceId: row.faceId,
        name: row.name ?? 'USUARIO',
        imageBuffer: buffer,
        photoKey: row.faceImageKey,
        logContext: `reg=${registrationId}`,
        previousDeviceSyncError: row.deviceSyncError,
      });

    await registrationsQueries.updateRegistrationDeviceSync(
      this.database.db,
      registrationId,
      clientId,
      {
        deviceSyncStatus,
        deviceSyncedAt: deviceSyncStatus === 'synced' ? new Date() : null,
        deviceSyncError,
      },
    );

    return { deviceSyncStatus, deviceSyncError };
  }

  async enqueueAllPendingRegistrations(
    user: JwtPayload,
    clientId: string,
  ): Promise<string[]> {
    if (user.role === 'client_admin' || user.role === 'client_operator') {
      this.ensureClientTenant(user);
    } else {
      await this.ensureCompanyCanAccessClient(user, clientId);
    }
    const rows =
      await registrationsQueries.listApprovedRegistrationsPendingDeviceSync(
        this.database.db,
        clientId,
      );
    const jobIds: string[] = [];
    for (const row of rows) {
      const job = await this.enqueueApprovedRegistrationJob(
        row.id,
        clientId,
        user.sub,
      );
      jobIds.push(job.jobId);
    }
    return jobIds;
  }

  async syncAllPendingForCompany(
    user: JwtPayload,
    clientId: string,
    emit: (e: FaceSyncProgressEvent) => void,
  ) {
    await this.ensureCompanyCanAccessClient(user, clientId);
    return this.syncAllPending(clientId, emit);
  }

  /**
   * Agenda o sync fora da request HTTP. O status `pending_sync` já deve ter
   * sido gravado pelo chamador.
   */
  enqueuePersonSync(payload: FaceSyncRequestedPayload): {
    deviceSyncStatus: 'pending_sync';
    deviceSyncError: null;
    jobId?: string;
  } {
    const entityId = payload.entityId ?? `${payload.clientId}:${payload.faceId}`;
    const entityKind = payload.entityKind ?? 'registration';
    const jobPayload: FacePersonJobPayload = {
      entityKind,
      faceId: payload.faceId,
      name: payload.name,
      photoKey: payload.photoKey ?? '',
      timeSectionIds: payload.timeSectionIds,
      validFrom: payload.validFrom?.toISOString(),
      validUntil: payload.validUntil?.toISOString(),
      photoOnly: payload.photoOnly,
      resetReaderProgress: payload.resetReaderProgress ?? true,
      previousDeviceSyncError: payload.previousDeviceSyncError,
      logContext: payload.logContext,
      userId: payload.userId,
      requestedByMemberId: payload.requestedByMemberId,
    };
    void this.queue
      .enqueue({
        kind: 'face.person',
        clientId: payload.clientId,
        targetId: entityId,
        dedupeKey: `face.person:${payload.clientId}:${entityKind}:${entityId}`,
        payload: jobPayload,
        total: 1,
      })
      .then((job) => {
        this.persistHooks.set(job.id, payload.persistResult);
      })
      .catch((err: unknown) => {
        this.log.warn(
          `enqueuePersonSync falhou: ${err instanceof Error ? err.message : String(err)}`,
        );
        void payload.persistResult({
          deviceSyncStatus: 'sync_failed',
          deviceSyncError:
            err instanceof Error ? err.message : 'Falha ao enfileirar sync.',
        });
      });
    return { deviceSyncStatus: 'pending_sync', deviceSyncError: null };
  }

  async enqueueApprovedRegistrationJob(
    registrationId: string,
    clientId: string,
    createdBy?: string,
  ) {
    const row = await registrationsQueries.getRegistrationByIdForClient(
      this.database.db,
      registrationId,
      clientId,
    );
    if (!row || row.status !== 'approved') {
      throw new NotFoundException(
        'Cadastro não encontrado ou não está aprovado.',
      );
    }
    if (!row.faceImageKey) {
      throw new BadRequestException('Cadastro sem foto.');
    }
    if (row.faceId == null) {
      throw new BadRequestException(
        'Cadastro sem face_id — reaprovar ou contactar suporte.',
      );
    }
    await registrationsQueries.updateRegistrationDeviceSync(
      this.database.db,
      registrationId,
      clientId,
      { deviceSyncStatus: 'pending_sync', deviceSyncedAt: null },
    );
    const job = await this.queue.enqueue({
      kind: 'face.person',
      clientId,
      targetId: registrationId,
      createdBy,
      dedupeKey: `face.person:${clientId}:registration:${registrationId}`,
      total: 1,
      payload: {
        entityKind: 'registration',
        faceId: row.faceId,
        name: row.name ?? 'USUARIO',
        photoKey: row.faceImageKey,
        logContext: `reg=${registrationId}`,
        previousDeviceSyncError: row.deviceSyncError,
      } satisfies FacePersonJobPayload,
    });
    return this.queue.toDto(job);
  }

  async enqueueReaderRebuildJob(
    clientId: string,
    readerId: string,
    force: boolean,
    createdBy?: string,
  ) {
    const active = await this.queue.listActiveFace(clientId);
    if (active.length > 0) {
      throw new ConflictException(
        'Já existe um sync de faces em andamento neste cliente.',
      );
    }
    if (force) {
      await personReaderSyncQueries.deletePersonReaderSyncByReader(
        this.database.db,
        clientId,
        readerId,
      );
    }
    const job = await this.queue.enqueue({
      kind: 'face.reader',
      clientId,
      targetId: readerId,
      force,
      createdBy,
      dedupeKey: `face.reader:${clientId}:${readerId}:${force ? 'force' : 'incremental'}`,
      payload: { force },
    });
    return this.queue.toDto(job);
  }

  async enqueueSchoolBatchJob(
    clientId: string,
    entityKind: 'student' | 'responsible',
    createdBy?: string,
  ) {
    const active = await this.queue.listActiveFace(clientId);
    if (active.length > 0) {
      throw new ConflictException(
        'Já existe um sync de faces em andamento neste cliente.',
      );
    }
    const job = await this.queue.enqueue({
      kind: 'face.school',
      clientId,
      targetId: clientId,
      createdBy,
      dedupeKey: `face.school:${clientId}:${entityKind}`,
      payload: { entityKind } satisfies FaceSchoolJobPayload,
    });
    return this.queue.toDto(job);
  }

  async listActiveFaceJobs(clientId: string) {
    const rows = await this.queue.listActiveFace(clientId);
    return rows.map((row) => this.queue.toDto(row));
  }

  async syncAllPendingForClientTenant(
    user: JwtPayload,
    emit: (e: FaceSyncProgressEvent) => void,
  ) {
    const clientId = this.ensureClientTenant(user);
    return this.syncAllPending(clientId, emit);
  }

  async syncAllPending(
    clientId: string,
    emit: (e: FaceSyncProgressEvent) => void,
  ): Promise<void> {
    const rows =
      await registrationsQueries.listApprovedRegistrationsPendingDeviceSync(
        this.database.db,
        clientId,
      );
    emit({ type: 'start', total: rows.length });

    const pingTimer = setInterval(() => emit({ type: 'ping' }), SSE_PING_MS);
    try {
      for (const r of rows) {
        try {
          await this.syncApprovedRegistration(r.id, clientId);
          const fresh = await registrationsQueries.getRegistrationByIdForClient(
            this.database.db,
            r.id,
            clientId,
          );
          const ok = isFullySyncedDevice(
            fresh?.deviceSyncStatus,
            fresh?.deviceSyncError,
          );
          emit({
            type: 'item',
            registrationId: r.id,
            name: fresh?.name ?? r.name ?? null,
            ok,
            error: ok ? undefined : (fresh?.deviceSyncError ?? undefined),
          });
        } catch (e) {
          emit({
            type: 'item',
            registrationId: r.id,
            name: r.name ?? null,
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      emit({ type: 'done' });
    } finally {
      clearInterval(pingTimer);
    }
  }
}
