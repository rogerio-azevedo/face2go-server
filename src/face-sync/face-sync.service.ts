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
import {
  mapReadersWithSyncGate,
  withReaderSyncGate,
} from '../common/concurrency/reader-sync-gate';
import { createReaderCredentialsCipher } from '../common/crypto/reader-credentials.cipher';
import type { EnvVars } from '../config/env.validation';
import { DatabaseService } from '../database/database.service';
import type { AppDb } from '../database/database.types';
import * as clientsQueries from '../database/queries/clients.queries';
import * as registrationsQueries from '../database/queries/registrations.queries';
import * as readersQueries from '../database/queries/readers.queries';
import * as personBirthDateQueries from '../database/queries/person-birth-date.queries';
import * as personReaderSyncQueries from '../database/queries/person-reader-sync.queries';
import { listPersonsByFaceIds } from '../database/queries/device-user-reconcile.queries';
import { PermissionsService } from '../permissions/permissions.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { imageBufferToReaderBase64Jpeg } from './face-image-for-reader';
import { loadOrCreateReaderFaceVariant } from './face-image-variants';
import {
  aggregateReaderSyncOutcome,
  isFullySyncedDevice,
} from './aggregate-reader-sync-outcome.util';
import type {
  FaceSyncOutcome,
  FaceSyncRequestedPayload,
} from './face-sync.events';
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
import {
  extractCollidingFaceId,
  withCollidingPerson,
} from './similar-face-collision.util';
import { AccessTimeZoneService } from './access-time-zone.service';
import { FaceMatchService } from '../face-match/face-match.service';
import {
  evaluatePersonAgeAccess,
  formatRestrictedReaderSyncError,
  isPersonAllowedOnReader,
  partitionReadersByMinorRestriction,
} from './minor-restriction';
import {
  readerLabel,
  syncLog,
  syncLogError,
} from './intelbras-sync-debug.util';

async function persistInvalidAgeRestrictions(
  db: AppDb,
  clientId: string,
  faceId: number,
  readers: readersQueries.ReaderFaceSyncRow[],
  birthDate: unknown,
): Promise<string[]> {
  if (readers.length === 0) return [];
  const failures = readers.map((reader) => {
    const decision = evaluatePersonAgeAccess(reader, birthDate);
    const reason =
      decision.reason === 'allowed' || decision.reason === 'unrestricted'
        ? 'missing_birth_date'
        : decision.reason;
    return formatRestrictedReaderSyncError(
      reader.name,
      reason,
      decision.minimumAccessAge ?? 18,
    );
  });
  await Promise.all(
    readers.map((reader, index) =>
      personReaderSyncQueries.upsertPersonReaderSync(db, {
        clientId,
        faceId,
        readerId: reader.id,
        status: 'sync_failed',
        error: failures[index] ?? null,
      }),
    ),
  );
  return failures;
}

async function persistUnavailableAgeRestrictions(
  db: AppDb,
  clientId: string,
  faceId: number,
  readers: readersQueries.ReaderAgePolicyRow[],
): Promise<string[]> {
  const failures = readers.map(
    (reader) =>
      `${reader.name}: leitor indisponível para confirmar a remoção exigida pela política ${reader.minimumAccessAge}+.`,
  );
  await Promise.all(
    readers.map((reader, index) =>
      personReaderSyncQueries.upsertPersonReaderSync(db, {
        clientId,
        faceId,
        readerId: reader.id,
        status: 'sync_failed',
        error: failures[index],
      }),
    ),
  );
  return failures;
}

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
    private readonly faceMatch: FaceMatchService,
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
    const { total } = await this.getReaderSyncCounts(clientId, []);
    return total > 0;
  }

  /** Total de leitores de face + quantos já estão `synced` por faceId. */
  async getReaderSyncCounts(
    clientId: string,
    faceIds: number[],
  ): Promise<{ total: number; syncedByFace: Map<number, number> }> {
    const [readers, syncedByFace] = await Promise.all([
      readersQueries.listReadersForFaceSyncByClient(this.database.db, clientId),
      personReaderSyncQueries.countSyncedPersonReaderSyncByFaceIds(
        this.database.db,
        clientId,
        faceIds,
      ),
    ]);
    return { total: readers.length, syncedByFace };
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
    blocked?: boolean;
    resetReaderProgress?: boolean;
    allowSimilarFace?: boolean;
    previousDeviceSyncError?: string | null;
    readerIds?: string[];
  }): Promise<{
    deviceSyncStatus: 'synced' | 'sync_failed';
    deviceSyncError: string | null;
  }> {
    const { clientId, faceId, name, imageBuffer, logContext, photoKey } =
      params;
    const photoOnly = params.photoOnly === true;
    const blocked = params.blocked === true;
    const allowSimilarFace = params.allowSimilarFace === true;
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

    await this.faceMatch.rememberPhoto({
      clientId,
      faceId,
      photoKey,
      imageBuffer,
      blocked,
    });

    try {
      const [allReaders, allAgePolicies, birthDate] = await Promise.all([
        readersQueries.listReadersForFaceSyncByClient(
          this.database.db,
          clientId,
        ),
        readersQueries.listActiveReaderAgePoliciesByClient(
          this.database.db,
          clientId,
        ),
        personBirthDateQueries.getBirthDateByFaceId(
          this.database.db,
          clientId,
          faceId,
        ),
      ]);
      const allowIds = params.readerIds?.filter((id) => id.trim());
      const scoped =
        allowIds && allowIds.length > 0
          ? allReaders.filter((r) => allowIds.includes(r.id))
          : allReaders;
      const scopedAgePolicies =
        allowIds && allowIds.length > 0
          ? allAgePolicies.filter((r) => allowIds.includes(r.id))
          : allAgePolicies;
      const availableReaderIds = new Set(scoped.map((reader) => reader.id));
      const unavailableRestricted = scopedAgePolicies.filter(
        (reader) =>
          !availableReaderIds.has(reader.id) &&
          !evaluatePersonAgeAccess(reader, birthDate).allowed,
      );
      const { allowed: readers, restricted } =
        partitionReadersByMinorRestriction(scoped, birthDate);
      const restrictionDecisions = restricted.map((reader) => ({
        reader,
        decision: evaluatePersonAgeAccess(reader, birthDate),
      }));
      const invalidDateRestricted = restrictionDecisions
        .filter(({ decision }) => decision.reason !== 'below_minimum_age')
        .map(({ reader }) => reader);

      if (params.resetReaderProgress === true && readers.length > 0) {
        await Promise.all(
          readers.map((reader) =>
            personReaderSyncQueries.deletePersonReaderSyncByFaceAndReader(
              this.database.db,
              clientId,
              faceId,
              reader.id,
            ),
          ),
        );
      }

      let restrictionRemovalFailures: string[] = [];
      let failedRemovalReaderIds = new Set<string>();
      if (restricted.length > 0) {
        const removal = await this.removePersonFromReaders({
          clientId,
          faceId,
          logContext: `${logPrefix}minor-restriction`,
          requireAll: false,
          readerIds: restricted.map((r) => r.id),
        });
        restrictionRemovalFailures = removal.failures;
        failedRemovalReaderIds = new Set(removal.failedReaderIds);
      }

      const invalidDateFailures = await persistInvalidAgeRestrictions(
        this.database.db,
        clientId,
        faceId,
        invalidDateRestricted.filter(
          (reader) => !failedRemovalReaderIds.has(reader.id),
        ),
        birthDate,
      );
      const unavailableRestrictionFailures =
        await persistUnavailableAgeRestrictions(
          this.database.db,
          clientId,
          faceId,
          unavailableRestricted,
        );
      const policyFailures = [
        ...restrictionRemovalFailures,
        ...invalidDateFailures,
        ...unavailableRestrictionFailures,
      ];
      const failedBelowMinimum = restrictionDecisions.filter(
        ({ reader, decision }) =>
          decision.reason === 'below_minimum_age' &&
          failedRemovalReaderIds.has(reader.id),
      ).length;
      const policyIssueTotal =
        invalidDateRestricted.length +
        failedBelowMinimum +
        unavailableRestricted.length;

      syncLog('syncPersonOnReaders:leitores', {
        clientId,
        faceId,
        total: readers.length,
        restricted: restricted.length,
        restrictionReasons: restrictionDecisions.map(
          ({ reader, decision }) => `${reader.id}:${decision.reason}`,
        ),
        unavailableRestricted: unavailableRestricted.map((r) => r.id),
        readers: readers.map((r) => readerLabel(r)),
      });

      if (readers.length === 0) {
        syncLog('syncPersonOnReaders:todosRestritos', {
          clientId,
          faceId,
          birthDate,
          restrictionReasons: restrictionDecisions.map(
            ({ decision }) => decision.reason,
          ),
        });
        if (policyFailures.length === 0) {
          if (scoped.length === 0) {
            return {
              deviceSyncStatus: 'sync_failed',
              deviceSyncError:
                'Nenhum leitor ativo com credenciais para este cliente.',
            };
          }
          return { deviceSyncStatus: 'synced', deviceSyncError: null };
        }
        return aggregateReaderSyncOutcome(policyFailures, policyIssueTotal);
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
                blocked,
                allowSimilarFace,
              });
            } else {
              if (!intelbrasBase64) {
                throw new Error(
                  'Falha ao preparar imagem para leitor Intelbras.',
                );
              }

              if (!photoOnly && !blocked) {
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
                { photoOnly, blocked, allowSimilarFace },
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
            return {
              message: msg,
              collidingFaceId: extractCollidingFaceId(e, faceId),
            };
          }
        },
      );

      const collidingIds = [
        ...new Set(
          outcomes.flatMap((outcome) =>
            outcome?.collidingFaceId != null ? [outcome.collidingFaceId] : [],
          ),
        ),
      ];
      const collidingPeople =
        collidingIds.length > 0
          ? await listPersonsByFaceIds(this.database.db, clientId, collidingIds)
          : new Map<number, { name: string }>();
      const namedByReader = outcomes.map((outcome) => {
        if (!outcome) return null;
        if (outcome.collidingFaceId == null) return outcome.message;
        return withCollidingPerson(outcome.message, {
          faceId: outcome.collidingFaceId,
          name: collidingPeople.get(outcome.collidingFaceId)?.name,
        });
      });
      const messages = await this.faceMatch.annotateUnnamedDuplicates({
        clientId,
        faceId,
        imageBuffer,
        messages: namedByReader,
        collidingFaceIds: outcomes.map(
          (outcome) => outcome?.collidingFaceId ?? null,
        ),
      });

      const failures = messages.filter((msg): msg is string => msg !== null);

      await Promise.all(
        plan.toSync.map((reader, index) => {
          const msg = messages[index] ?? null;
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

      failures.push(...policyFailures);

      const outcome = aggregateReaderSyncOutcome(
        failures,
        readers.length + policyIssueTotal,
      );

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
        synced: Math.max(0, readers.length - failures.length),
        skipped: plan.skipped.length,
        total: readers.length + policyIssueTotal,
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
    /** Quando informado, remove só destes leitores. */
    readerIds?: string[];
  }): Promise<{
    removed: number;
    total: number;
    failures: string[];
    failedReaderIds: string[];
  }> {
    const { clientId, faceId, logContext, requireAll = true } = params;
    const allReaders = await readersQueries.listReadersForFaceSyncByClient(
      this.database.db,
      clientId,
    );
    const allowIds = params.readerIds?.filter((id) => id.trim());
    const readers =
      allowIds && allowIds.length > 0
        ? allReaders.filter((r) => allowIds.includes(r.id))
        : allReaders;
    if (readers.length === 0) {
      return { removed: 0, total: 0, failures: [], failedReaderIds: [] };
    }

    const cipher = createReaderCredentialsCipher(
      this.configService.get('READER_ENCRYPTION_KEY', { infer: true }),
    );
    const logPrefix = logContext ? `${logContext} ` : '';
    const failures: string[] = [];
    const failedReaderIds: string[] = [];

    await Promise.all(
      readers.map((r) =>
        withReaderSyncGate(r.id, async () => {
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
            await personReaderSyncQueries.deletePersonReaderSyncByFaceAndReader(
              this.database.db,
              clientId,
              faceId,
              r.id,
            );
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            const failure = `${r.name}: ${msg}`;
            failures.push(failure);
            failedReaderIds.push(r.id);
            await personReaderSyncQueries.upsertPersonReaderSync(
              this.database.db,
              {
                clientId,
                faceId,
                readerId: r.id,
                status: 'sync_failed',
                error: failure,
              },
            );
            this.log.warn(
              `${logPrefix}Falha ao remover face ${faceId} do leitor ${r.name}: ${msg}`,
            );
          }
        }),
      ),
    );

    const result = {
      removed: readers.length - failures.length,
      total: readers.length,
      failures,
      failedReaderIds,
    };

    if (failures.length > 0 && requireAll) {
      throw new BadRequestException(
        `Não foi possível remover a face de todos os leitores (${failures.length} de ${readers.length} falhou). ${failures.join('; ')}`,
      );
    }

    return result;
  }

  /**
   * Remove do leitor as faces inelegíveis quando existe idade mínima configurada.
   * Usa o union de faces já sincronizadas neste leitor + faces conhecidas do cliente.
   */
  async purgeIneligibleFacesFromReader(
    clientId: string,
    readerId: string,
  ): Promise<number> {
    const readers = await readersQueries.listReadersForFaceSyncByClient(
      this.database.db,
      clientId,
    );
    const reader = readers.find((r) => r.id === readerId);
    if (!reader) {
      throw new BadRequestException(
        'Leitor ativo com credenciais não encontrado para reconciliar a política.',
      );
    }
    if (reader.minimumAccessAge == null) return 0;

    const [synced, known] = await Promise.all([
      personReaderSyncQueries.listSyncedFaceIdsByReader(
        this.database.db,
        clientId,
        readerId,
      ),
      personBirthDateQueries.listFaceIdsByClient(this.database.db, clientId),
    ]);
    const candidates = new Set<number>([...synced, ...known]);
    if (candidates.size === 0) return 0;

    const birthDates = await personBirthDateQueries.listBirthDatesByFaceIds(
      this.database.db,
      clientId,
      [...candidates],
    );
    const ineligible = [...candidates].filter(
      (faceId) =>
        !isPersonAllowedOnReader(reader, birthDates.get(faceId) ?? null),
    );
    if (ineligible.length === 0) return 0;

    return withReaderSyncGate(reader.id, async () => {
      const cipher = createReaderCredentialsCipher(
        this.configService.get('READER_ENCRYPTION_KEY', { infer: true }),
      );
      const plain = toPlainReaderCredential(
        reader,
        cipher.decrypt(reader.passwordEncrypted),
      );
      let removed = 0;
      const failures: string[] = [];
      for (const faceId of ineligible) {
        try {
          if (reader.brand === 'hikvision') {
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
          removed += 1;
          await personReaderSyncQueries.deletePersonReaderSyncByFaceAndReader(
            this.database.db,
            clientId,
            faceId,
            readerId,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const failure = `${reader.name}: face ${faceId}: ${msg}`;
          failures.push(failure);
          await personReaderSyncQueries.upsertPersonReaderSync(
            this.database.db,
            {
              clientId,
              faceId,
              readerId,
              status: 'sync_failed',
              error: failure,
            },
          );
          this.log.warn(
            `minor-purge reader=${reader.name} face=${faceId}: ${msg}`,
          );
        }
      }
      if (failures.length > 0) {
        throw new BadRequestException(
          `Não foi possível confirmar a remoção de ${failures.length} face(s). ${failures.join('; ')}`,
        );
      }
      return removed;
    });
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
    if (
      !row ||
      !row.isActive ||
      (row.status !== 'approved' && row.status !== 'blocked')
    ) {
      throw new NotFoundException(
        'Cadastro não encontrado, excluído ou sem face para sincronizar.',
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
        blocked: row.status === 'blocked',
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
    force = false,
  ): Promise<string[]> {
    if (user.role === 'client_admin' || user.role === 'client_operator') {
      this.ensureClientTenant(user);
    } else {
      await this.ensureCompanyCanAccessClient(user, clientId);
    }
    const rows =
      await registrationsQueries.listApprovedRegistrationsForDeviceSync(
        this.database.db,
        clientId,
        { includeSynced: force },
      );
    const jobIds: string[] = [];
    for (const row of rows) {
      const job = await this.enqueueApprovedRegistrationJob(
        row.id,
        clientId,
        user.sub,
        { resetReaderProgress: force },
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
  async enqueuePersonSync(payload: FaceSyncRequestedPayload): Promise<{
    deviceSyncStatus: 'pending_sync' | 'sync_failed';
    deviceSyncError: string | null;
    jobId?: string;
  }> {
    const entityId =
      payload.entityId ?? `${payload.clientId}:${payload.faceId}`;
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
      blocked: payload.blocked,
      resetReaderProgress: payload.resetReaderProgress ?? true,
      allowSimilarFace: payload.allowSimilarFace === true,
      previousDeviceSyncError: payload.previousDeviceSyncError,
      logContext: payload.logContext,
      userId: payload.userId,
      requestedByMemberId: payload.requestedByMemberId,
    };
    try {
      const job = await this.queue.enqueue({
        kind: 'face.person',
        clientId: payload.clientId,
        targetId: entityId,
        dedupeKey: payload.allowSimilarFace
          ? `face.person:${payload.clientId}:${entityKind}:${entityId}:similar`
          : `face.person:${payload.clientId}:${entityKind}:${entityId}`,
        payload: jobPayload,
        total: 1,
      });
      this.persistHooks.set(job.id, payload.persistResult);
      return {
        deviceSyncStatus: 'pending_sync',
        deviceSyncError: null,
        jobId: job.id,
      };
    } catch (err: unknown) {
      const deviceSyncError =
        err instanceof Error ? err.message : 'Falha ao enfileirar sync.';
      this.log.warn(`enqueuePersonSync falhou: ${deviceSyncError}`);
      await payload.persistResult({
        deviceSyncStatus: 'sync_failed',
        deviceSyncError,
      });
      return { deviceSyncStatus: 'sync_failed', deviceSyncError };
    }
  }

  assertCanAllowSimilarFace(user: JwtPayload): void {
    if (user.role !== 'company_admin' && user.role !== 'client_admin') {
      throw new ForbiddenException(
        'Só um administrador pode liberar face parecida.',
      );
    }
  }

  async enqueueApprovedRegistrationJob(
    registrationId: string,
    clientId: string,
    createdBy?: string,
    options?: {
      resetReaderProgress?: boolean;
      blocked?: boolean;
      allowSimilarFace?: boolean;
    },
  ) {
    const resetReaderProgress = options?.resetReaderProgress === true;
    const allowSimilarFace = options?.allowSimilarFace === true;
    const row = await registrationsQueries.getRegistrationByIdForClient(
      this.database.db,
      registrationId,
      clientId,
    );
    if (
      !row ||
      !row.isActive ||
      (row.status !== 'approved' && row.status !== 'blocked')
    ) {
      throw new NotFoundException(
        'Cadastro não encontrado, excluído ou sem face para sincronizar.',
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
      {
        deviceSyncStatus: 'pending_sync',
        deviceSyncedAt: null,
        deviceSyncError: resetReaderProgress ? null : row.deviceSyncError,
      },
    );
    const dedupeKey = allowSimilarFace
      ? `face.person:${clientId}:registration:${registrationId}:similar`
      : resetReaderProgress
        ? `face.person:${clientId}:registration:${registrationId}:force`
        : `face.person:${clientId}:registration:${registrationId}`;
    let job: Awaited<ReturnType<DeviceSyncQueueService['enqueue']>>;
    try {
      job = await this.queue.enqueue({
        kind: 'face.person',
        clientId,
        targetId: registrationId,
        createdBy,
        force: resetReaderProgress,
        dedupeKey,
        total: 1,
        payload: {
          entityKind: 'registration',
          faceId: row.faceId,
          name: row.name ?? 'USUARIO',
          photoKey: row.faceImageKey,
          logContext: `reg=${registrationId}`,
          previousDeviceSyncError: resetReaderProgress
            ? null
            : row.deviceSyncError,
          resetReaderProgress,
          allowSimilarFace,
          blocked: options?.blocked === true || row.status === 'blocked',
        } satisfies FacePersonJobPayload,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Falha ao enfileirar sync.';
      try {
        await registrationsQueries.updateRegistrationDeviceSync(
          this.database.db,
          registrationId,
          clientId,
          {
            deviceSyncStatus: 'sync_failed',
            deviceSyncedAt: null,
            deviceSyncError: message,
          },
        );
      } catch (persistErr: unknown) {
        this.log.warn(
          `Falha ao persistir erro da fila reg=${registrationId}: ${
            persistErr instanceof Error
              ? persistErr.message
              : String(persistErr)
          }`,
        );
      }
      throw err;
    }
    return {
      ...this.queue.toDto(job),
      deviceSyncStatus: 'pending_sync' as const,
      deviceSyncError: null,
    };
  }

  async getApprovedRegistrationSyncStatus(
    registrationId: string,
    clientId: string,
  ): Promise<{
    deviceSyncStatus: string;
    deviceSyncError: string | null;
    readerSyncSynced: number | null;
    readerSyncTotal: number | null;
  }> {
    const row = await registrationsQueries.getRegistrationByIdForClient(
      this.database.db,
      registrationId,
      clientId,
    );
    if (
      !row ||
      !row.isActive ||
      (row.status !== 'approved' && row.status !== 'blocked')
    ) {
      throw new NotFoundException(
        'Cadastro não encontrado, excluído ou sem face para sincronizar.',
      );
    }
    const progress = await this.getReaderSyncCounts(
      clientId,
      row.faceId != null ? [row.faceId] : [],
    );
    return {
      deviceSyncStatus: row.deviceSyncStatus ?? 'pending_sync',
      deviceSyncError: row.deviceSyncError ?? null,
      readerSyncSynced:
        row.faceId != null
          ? (progress.syncedByFace.get(row.faceId) ?? 0)
          : null,
      readerSyncTotal: progress.total > 0 ? progress.total : null,
    };
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

  async enqueueAgePolicyReconciliation(
    clientId: string,
    readerId: string,
    agePolicyVersion: number,
    createdBy?: string,
  ) {
    const job = await this.queue.enqueue({
      kind: 'face.reader',
      clientId,
      targetId: readerId,
      force: false,
      createdBy,
      dedupeKey: `face.reader:${clientId}:${readerId}:age-policy:${agePolicyVersion}`,
      payload: { force: false, agePolicyVersion },
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

  async getRegistrationSyncAllStatus(
    user: JwtPayload,
    clientId: string,
  ): Promise<{ queued: number; running: number }> {
    if (user.role === 'client_admin' || user.role === 'client_operator') {
      this.ensureClientTenant(user);
    } else {
      await this.ensureCompanyCanAccessClient(user, clientId);
    }
    const jobs = await this.listActiveFaceJobs(clientId);
    return {
      queued: jobs.filter((job) => job.status === 'queued').length,
      running: jobs.filter((job) => job.status === 'running').length,
    };
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
