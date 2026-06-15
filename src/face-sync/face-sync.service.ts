import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { createReaderCredentialsCipher } from '../common/crypto/reader-credentials.cipher';
import type { EnvVars } from '../config/env.validation';
import { DatabaseService } from '../database/database.service';
import * as clientsQueries from '../database/queries/clients.queries';
import * as registrationsQueries from '../database/queries/registrations.queries';
import * as readersQueries from '../database/queries/readers.queries';
import { PermissionsService } from '../permissions/permissions.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { imageBufferToReaderBase64Jpeg } from './face-image-for-reader';
import {
  formatReaderFaceSyncError,
  intelbrasRemoveUserFromReader,
  intelbrasUpsertFaceOnReader,
  toPlainReaderCredential,
} from './intelbras-device.client';
import { dateToIntelbrasFormat } from './intelbras-valid-date.util';
import { ALWAYS_TIME_ZONE_INDEX } from './intelbras-time-zone.constants';
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
  | { type: 'done' }
  | { type: 'error'; message: string };

@Injectable()
export class FaceSyncService {
  private readonly log = new Logger(FaceSyncService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly r2: R2StorageService,
    private readonly configService: ConfigService<EnvVars, true>,
    private readonly permissionsService: PermissionsService,
    private readonly accessTimeZone: AccessTimeZoneService,
  ) {}

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
   * Envia uma imagem (buffer) para todos os leitores Intelbras ativos do cliente.
   * Não persiste status em tabela; o chamador atualiza `device_sync_*`.
   */
  async syncPersonOnReaders(params: {
    clientId: string;
    faceId: number;
    name: string;
    imageBuffer: Buffer;
    timeSectionIds?: number[];
    logContext?: string;
    validFrom?: Date;
    validUntil?: Date;
  }): Promise<{
    deviceSyncStatus: 'synced' | 'sync_failed';
    deviceSyncError: string | null;
  }> {
    const { clientId, faceId, name, imageBuffer, logContext } = params;
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
      const intelbrasReaders =
        await readersQueries.listReadersForFaceSyncByClient(
          this.database.db,
          clientId,
        );

      syncLog('syncPersonOnReaders:leitores', {
        clientId,
        faceId,
        total: intelbrasReaders.length,
        readers: intelbrasReaders.map((r) => readerLabel(r)),
      });

      if (intelbrasReaders.length === 0) {
        syncLog('syncPersonOnReaders:semLeitores', { clientId, faceId });
        return {
          deviceSyncStatus: 'sync_failed',
          deviceSyncError:
            'Nenhum leitor Intelbras ativo com credenciais para este cliente.',
        };
      }

      let base64: string;
      try {
        syncLog('syncPersonOnReaders:compressImage', { clientId, faceId });
        base64 = await imageBufferToReaderBase64Jpeg(imageBuffer);
        syncLog('syncPersonOnReaders:compressImageOk', {
          clientId,
          faceId,
          base64Chars: base64.length,
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

      const cipher = createReaderCredentialsCipher(
        this.configService.get('READER_ENCRYPTION_KEY', { infer: true }),
      );

      const shiftsByZone =
        await this.accessTimeZone.loadShiftsByZoneIndex(clientId);

      syncLog('syncPersonOnReaders:schedulesCarregados', {
        clientId,
        faceId,
        zonas: [...shiftsByZone.keys()],
      });

      const failures: string[] = [];

      const outcomes = await Promise.all(
        intelbrasReaders.map(async (r) => {
          const label = readerLabel(r);
          try {
            syncLog('syncPersonOnReaders:leitorInicio', {
              clientId,
              faceId,
              reader: label,
            });
            const plain = toPlainReaderCredential(
              r,
              cipher.decrypt(r.passwordEncrypted),
            );

            // 1) Zona no leitor → 2) Cartão → 3) Foto (ordem exigida pelo firmware)
            await this.accessTimeZone.ensureZonesOnSingleReader(
              plain,
              timeSectionIds,
              shiftsByZone,
            );

            await intelbrasUpsertFaceOnReader(
              plain,
              faceId,
              name || 'USUARIO',
              base64,
              timeSectionIds,
              validDateStart,
              validDateEnd,
            );
            syncLog('syncPersonOnReaders:leitorOk', {
              clientId,
              faceId,
              reader: label,
            });
            return null;
          } catch (e) {
            const msg = formatReaderFaceSyncError(r.name, e);
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
        }),
      );

      for (const m of outcomes) {
        if (m !== null) failures.push(m);
      }

      if (failures.length === intelbrasReaders.length) {
        const failedCount = failures.length;
        const total = intelbrasReaders.length;
        const err = `Não foi possível sincronizar com ${failedCount} de ${total} leitor(es).`;
        syncLog('syncPersonOnReaders:todosFalharam', {
          clientId,
          faceId,
          failures,
        });
        return { deviceSyncStatus: 'sync_failed', deviceSyncError: err };
      }

      const warn =
        failures.length > 0
          ? `Sincronizado parcialmente (${intelbrasReaders.length - failures.length} de ${intelbrasReaders.length} leitor(es)).`
          : null;

      syncLog('syncPersonOnReaders:concluido', {
        clientId,
        faceId,
        synced: intelbrasReaders.length - failures.length,
        total: intelbrasReaders.length,
        partial: failures.length > 0,
      });

      return { deviceSyncStatus: 'synced', deviceSyncError: warn };
    } catch (err) {
      syncLogError('syncPersonOnReaders', err, { clientId, faceId });
      throw err;
    }
  }

  /** Remove face_id dos leitores Intelbras ativos do cliente (exclusão de responsável). */
  async removePersonFromReaders(params: {
    clientId: string;
    faceId: number;
    logContext?: string;
    /** Quando true (padrão), falha se algum leitor não remover a face. */
    requireAll?: boolean;
  }): Promise<{ removed: number; total: number; failures: string[] }> {
    const { clientId, faceId, logContext, requireAll = true } = params;
    const intelbrasReaders =
      await readersQueries.listReadersForFaceSyncByClient(
        this.database.db,
        clientId,
      );
    if (intelbrasReaders.length === 0) {
      return { removed: 0, total: 0, failures: [] };
    }

    const cipher = createReaderCredentialsCipher(
      this.configService.get('READER_ENCRYPTION_KEY', { infer: true }),
    );
    const logPrefix = logContext ? `${logContext} ` : '';
    const failures: string[] = [];

    await Promise.all(
      intelbrasReaders.map(async (r) => {
        try {
          const plain = toPlainReaderCredential(
            r,
            cipher.decrypt(r.passwordEncrypted),
          );
          await intelbrasRemoveUserFromReader(plain, faceId);
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
      removed: intelbrasReaders.length - failures.length,
      total: intelbrasReaders.length,
      failures,
    };

    if (failures.length > 0 && requireAll) {
      throw new BadRequestException(
        `Não foi possível remover a face de todos os leitores (${failures.length} de ${intelbrasReaders.length} falhou). ${failures.join('; ')}`,
      );
    }

    return result;
  }

  /** Sincroniza um cadastro aprovado (foto no R2) com todos os leitores Intelbras ativos do cliente. */
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
        logContext: `reg=${registrationId}`,
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

  async syncAllPendingForCompany(
    user: JwtPayload,
    clientId: string,
    emit: (e: FaceSyncProgressEvent) => void,
  ) {
    await this.ensureCompanyCanAccessClient(user, clientId);
    return this.syncAllPending(clientId, emit);
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
    for (const r of rows) {
      try {
        await this.syncApprovedRegistration(r.id, clientId);
        const fresh = await registrationsQueries.getRegistrationByIdForClient(
          this.database.db,
          r.id,
          clientId,
        );
        const ok = fresh?.deviceSyncStatus === 'synced';
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
  }
}
