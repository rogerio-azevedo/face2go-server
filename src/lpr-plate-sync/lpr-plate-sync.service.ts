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
import * as camerasQueries from '../database/queries/cameras.queries';
import * as clientsQueries from '../database/queries/clients.queries';
import * as vehiclesQueries from '../database/queries/vehicles.queries';
import { PermissionsService } from '../permissions/permissions.service';
import { withReaderSyncGate } from '../common/concurrency/reader-sync-gate';
import { DeviceSyncQueueService } from '../device-sync-queue/device-sync-queue.service';
import * as vehicleCameraSyncQueries from '../database/queries/vehicle-camera-sync.queries';
import {
  formatCameraLprPlateError,
  intelbrasInsertPlate,
  intelbrasRemovePlate,
  toPlainCameraCredential,
} from './intelbras-lpr-device.client';

export type LprPlateSyncProgressEvent =
  | { type: 'start'; total: number }
  | {
      type: 'item';
      vehicleId: string;
      plate: string;
      ok: boolean;
      error?: string;
    }
  | { type: 'done' }
  | { type: 'error'; message: string };

export type SyncVehiclePlateResult = {
  lprSyncStatus: 'pending_sync' | 'synced' | 'sync_failed';
  lprSyncError: string | null;
};

@Injectable()
export class LprPlateSyncService {
  private readonly log = new Logger(LprPlateSyncService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly configService: ConfigService<EnvVars, true>,
    private readonly permissionsService: PermissionsService,
    private readonly queue: DeviceSyncQueueService,
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

  /** Indica se o cliente possui ao menos uma câmera LPR Intelbras ativa com credenciais. */
  async hasActiveLprCameras(clientId: string): Promise<boolean> {
    const cams = await camerasQueries.listCamerasForLprPlateSyncByClient(
      this.database.db,
      clientId,
    );
    return cams.length > 0;
  }

  /**
   * Empurra placa às câmeras LPR sem persistir em `vehicles` (ex.: convidado de retirada temporária).
   */
  async pushPlateToLprCameras(params: {
    clientId: string;
    plate: string;
    ownerDisplayName: string;
    vehicleColor?: string | null;
    logContext?: string;
  }): Promise<SyncVehiclePlateResult> {
    const { clientId, plate, ownerDisplayName, vehicleColor, logContext } =
      params;
    const pl = plate.trim();
    const logPrefix = logContext ? `${logContext} ` : '';

    if (!pl) {
      return {
        lprSyncStatus: 'sync_failed',
        lprSyncError: 'Placa obrigatória para sincronizar com LPR.',
      };
    }

    const cams = await camerasQueries.listCamerasForLprPlateSyncByClient(
      this.database.db,
      clientId,
    );

    if (cams.length === 0) {
      const msg =
        'Nenhuma câmera LPR Intelbras ativa com credenciais para este cliente.';
      return { lprSyncStatus: 'sync_failed', lprSyncError: msg };
    }

    const cipher = createReaderCredentialsCipher(
      this.configService.get('READER_ENCRYPTION_KEY', { infer: true }),
    );

    const failures: string[] = [];
    const outcomes = await Promise.all(
      cams.map(async (r) => {
        try {
          const plain = toPlainCameraCredential(
            r,
            cipher.decrypt(r.passwordEncrypted),
          );
          await intelbrasInsertPlate(
            plain,
            pl,
            ownerDisplayName.trim() ? ownerDisplayName : 'CONDUTOR',
            vehicleColor,
          );
          return null;
        } catch (e) {
          const msg = formatCameraLprPlateError(r.name, e);
          const raw =
            e instanceof Error
              ? e.message
              : typeof e === 'string'
                ? e
                : String(e);
          this.log.warn(
            `${logPrefix}LPR push plate=${pl} cam=${r.name}: ${raw}`,
          );
          return msg;
        }
      }),
    );

    for (const m of outcomes) {
      if (m !== null) failures.push(m);
    }

    if (failures.length === cams.length) {
      const err = `Não foi possível sincronizar com ${failures.length} de ${cams.length} câmera(s).`;
      return { lprSyncStatus: 'sync_failed', lprSyncError: err };
    }

    const warn =
      failures.length > 0
        ? `Sincronizado parcialmente (${cams.length - failures.length} de ${cams.length} câmera(s)).`
        : null;
    return { lprSyncStatus: 'synced', lprSyncError: warn };
  }

  /** Insere/atualiza a placa nas câmeras LPR Intelbras ativas do cliente e persiste o status global. */
  async enqueueVehicleJob(
    clientId: string,
    vehicleId: string,
    payload: {
      plate: string;
      ownerDisplayName: string;
      vehicleColor?: string | null;
      logContext?: string;
    },
    createdBy?: string,
  ) {
    const job = await this.queue.enqueue({
      kind: 'lpr.vehicle',
      clientId,
      targetId: vehicleId,
      createdBy,
      dedupeKey: `lpr.vehicle:${clientId}:${vehicleId}`,
      total: 1,
      payload,
    });
    return this.queue.toDto(job);
  }

  async enqueueCameraJob(
    clientId: string,
    cameraId: string,
    force: boolean,
    createdBy?: string,
  ) {
    if (force) {
      await vehicleCameraSyncQueries.deleteVehicleCameraSyncByCamera(
        this.database.db,
        clientId,
        cameraId,
      );
    }
    const job = await this.queue.enqueue({
      kind: 'lpr.camera',
      clientId,
      targetId: cameraId,
      force,
      createdBy,
      dedupeKey: `lpr.camera:${clientId}:${cameraId}:${force ? 'force' : 'incremental'}`,
      payload: { force },
    });
    return this.queue.toDto(job);
  }

  async syncAllVehiclesToCamera(
    clientId: string,
    cameraId: string,
    options: { skipSynced?: boolean },
    onProgress?: (processed: number, total: number) => Promise<void>,
  ): Promise<{ processed: number; total: number }> {
    const rows = await vehiclesQueries.listVehiclesForLprPlateSync(
      this.database.db,
      clientId,
    );
    const already = options.skipSynced
      ? await vehicleCameraSyncQueries.listSyncedVehicleIdsByCamera(
          this.database.db,
          clientId,
          cameraId,
        )
      : new Set<string>();
    const pending = rows.filter((row) => !already.has(row.id) && row.plate.trim());
    let processed = 0;
    await onProgress?.(0, pending.length);
    for (const row of pending) {
      await this.syncVehiclePlateOnCameras({
        clientId,
        vehicleId: row.id,
        plate: row.plate,
        ownerDisplayName: row.driverName ?? 'CONDUTOR',
        vehicleColor: row.color,
        logContext: `camera-rebuild=${cameraId}:${row.id}`,
        cameraIds: [cameraId],
      });
      processed += 1;
      await onProgress?.(processed, pending.length);
    }
    return { processed, total: pending.length };
  }

  async syncVehiclePlateOnCameras(params: {
    clientId: string;
    vehicleId: string;
    plate: string;
    ownerDisplayName: string;
    vehicleColor?: string | null;
    logContext?: string;
    cameraIds?: string[];
    resetCameraProgress?: boolean;
  }): Promise<SyncVehiclePlateResult> {
    const {
      clientId,
      vehicleId,
      plate,
      ownerDisplayName,
      vehicleColor,
      logContext,
    } = params;
    const pl = plate.trim();

    const logPrefix = logContext ? `${logContext} ` : '';

    await vehiclesQueries.updateVehicleLprSync(
      this.database.db,
      vehicleId,
      clientId,
      {
        lprSyncStatus: 'pending_sync',
        lprSyncedAt: null,
        lprSyncError: null,
      },
    );

    if (!pl) {
      const msg = 'Placa obrigatória para sincronizar com LPR.';
      await vehiclesQueries.updateVehicleLprSync(
        this.database.db,
        vehicleId,
        clientId,
        {
          lprSyncStatus: 'sync_failed',
          lprSyncError: msg,
          lprSyncedAt: null,
        },
      );
      return { lprSyncStatus: 'sync_failed', lprSyncError: msg };
    }

    if (params.resetCameraProgress) {
      await vehicleCameraSyncQueries.deleteVehicleCameraSyncByVehicle(
        this.database.db,
        clientId,
        vehicleId,
      );
    }

    const allCams = await camerasQueries.listCamerasForLprPlateSyncByClient(
      this.database.db,
      clientId,
    );
    const allowIds = params.cameraIds?.filter((id) => id.trim());
    const cams =
      allowIds && allowIds.length > 0
        ? allCams.filter((cam) => allowIds.includes(cam.id))
        : allCams;

    if (cams.length === 0) {
      const msg =
        'Nenhuma câmera LPR Intelbras ativa com credenciais para este cliente.';
      await vehiclesQueries.updateVehicleLprSync(
        this.database.db,
        vehicleId,
        clientId,
        {
          lprSyncStatus: 'sync_failed',
          lprSyncError: msg,
          lprSyncedAt: null,
        },
      );
      return { lprSyncStatus: 'sync_failed', lprSyncError: msg };
    }

    const existing = params.resetCameraProgress
      ? []
      : await vehicleCameraSyncQueries.listVehicleCameraSyncByVehicle(
          this.database.db,
          clientId,
          vehicleId,
        );
    const syncedCamIds = new Set(
      existing.filter((row) => row.status === 'synced').map((row) => row.cameraId),
    );
    const toSync = cams.filter((cam) => !syncedCamIds.has(cam.id));

    const cipher = createReaderCredentialsCipher(
      this.configService.get('READER_ENCRYPTION_KEY', { infer: true }),
    );

    const failures: string[] = [];

    const outcomes = await Promise.all(
      toSync.map((r) =>
        withReaderSyncGate(`lpr:${r.id}`, async () => {
          try {
            const plain = toPlainCameraCredential(
              r,
              cipher.decrypt(r.passwordEncrypted),
            );
            await intelbrasInsertPlate(
              plain,
              pl,
              ownerDisplayName.trim() ? ownerDisplayName : 'CONDUTOR',
              vehicleColor,
            );
            await vehicleCameraSyncQueries.upsertVehicleCameraSync(
              this.database.db,
              {
                clientId,
                vehicleId,
                cameraId: r.id,
                status: 'synced',
                error: null,
              },
            );
            return null;
          } catch (e) {
            const msg = formatCameraLprPlateError(r.name, e);
            const raw =
              e instanceof Error
                ? e.message
                : typeof e === 'string'
                  ? e
                  : String(e);
            this.log.warn(
              `${logPrefix}LPR sync plate=${pl} cam=${r.name}: ${raw}`,
            );
            await vehicleCameraSyncQueries.upsertVehicleCameraSync(
              this.database.db,
              {
                clientId,
                vehicleId,
                cameraId: r.id,
                status: 'sync_failed',
                error: msg,
              },
            );
            return msg;
          }
        }),
      ),
    );

    for (const m of outcomes) {
      if (m !== null) failures.push(m);
    }

    const okCount = syncedCamIds.size + (toSync.length - failures.length);
    if (okCount === 0) {
      const err = `Não foi possível sincronizar com ${failures.length} de ${cams.length} câmera(s).`;
      await vehiclesQueries.updateVehicleLprSync(
        this.database.db,
        vehicleId,
        clientId,
        {
          lprSyncStatus: 'sync_failed',
          lprSyncError: err,
          lprSyncedAt: null,
        },
      );
      return { lprSyncStatus: 'sync_failed', lprSyncError: err };
    }

    const warn =
      failures.length > 0
        ? `Sincronizado parcialmente (${okCount} de ${cams.length} câmera(s)).`
        : null;
    await vehiclesQueries.updateVehicleLprSync(
      this.database.db,
      vehicleId,
      clientId,
      {
        lprSyncStatus: 'synced',
        lprSyncError: warn,
        lprSyncedAt: new Date(),
      },
    );
    return { lprSyncStatus: 'synced', lprSyncError: warn };
  }

  /** Remove a placa de todas as câmeras LPR Intelbras do cliente (tolerante a ausência na lista). */
  async removePlateFromAllLprCameras(
    clientId: string,
    plate: string,
    logContext?: string,
    options?: { requireAll?: boolean },
  ): Promise<{ removed: number; total: number; failures: string[] }> {
    const pl = plate.trim();
    if (!pl) return { removed: 0, total: 0, failures: [] };

    const requireAll = options?.requireAll ?? false;

    const cams = await camerasQueries.listCamerasForLprPlateSyncByClient(
      this.database.db,
      clientId,
    );
    if (cams.length === 0) return { removed: 0, total: 0, failures: [] };

    const cipher = createReaderCredentialsCipher(
      this.configService.get('READER_ENCRYPTION_KEY', { infer: true }),
    );
    const logPrefix = logContext ? `${logContext} ` : '';
    const failures: string[] = [];

    await Promise.all(
      cams.map(async (r) => {
        try {
          const plain = toPlainCameraCredential(
            r,
            cipher.decrypt(r.passwordEncrypted),
          );
          await intelbrasRemovePlate(plain, pl);
        } catch (e) {
          const raw =
            e instanceof Error
              ? e.message
              : typeof e === 'string'
                ? e
                : String(e);
          failures.push(`${r.name}: ${raw}`);
          this.log.warn(
            `${logPrefix}LPR remove plate=${pl} cam=${r.name}: ${raw}`,
          );
        }
      }),
    );

    const result = {
      removed: cams.length - failures.length,
      total: cams.length,
      failures,
    };

    if (failures.length > 0 && requireAll) {
      throw new BadRequestException(
        `Não foi possível remover a placa ${pl} de todas as câmeras (${failures.length} de ${cams.length} falhou). ${failures.join('; ')}`,
      );
    }

    return result;
  }

  async syncVehicleForCompany(
    user: JwtPayload,
    clientId: string,
    vehicleId: string,
  ) {
    await this.ensureCompanyCanAccessClient(user, clientId);

    const v = await vehiclesQueries.vehicleGetWithDriver(
      this.database.db,
      vehicleId,
      clientId,
    );
    if (!v) throw new NotFoundException('Veículo não encontrado.');
    await vehiclesQueries.updateVehicleLprSync(
      this.database.db,
      vehicleId,
      clientId,
      {
        lprSyncStatus: 'pending_sync',
        lprSyncedAt: null,
        lprSyncError: null,
      },
    );
    return this.enqueueVehicleJob(
      clientId,
      vehicleId,
      {
        plate: v.plate,
        ownerDisplayName: v.driverName ?? 'CONDUTOR',
        vehicleColor: v.color,
        logContext: `vehicle=${vehicleId}`,
      },
      user.sub,
    );
  }

  async syncVehicleForClientTenant(user: JwtPayload, vehicleId: string) {
    const clientId = this.ensureClientTenant(user);
    const v = await vehiclesQueries.vehicleGetWithDriver(
      this.database.db,
      vehicleId,
      clientId,
    );
    if (!v) throw new NotFoundException('Veículo não encontrado.');
    await vehiclesQueries.updateVehicleLprSync(
      this.database.db,
      vehicleId,
      clientId,
      {
        lprSyncStatus: 'pending_sync',
        lprSyncedAt: null,
        lprSyncError: null,
      },
    );
    return this.enqueueVehicleJob(
      clientId,
      vehicleId,
      {
        plate: v.plate,
        ownerDisplayName: v.driverName ?? 'CONDUTOR',
        vehicleColor: v.color,
        logContext: `vehicle=${vehicleId}`,
      },
      user.sub,
    );
  }

  /** Envia todas as placas ao ativar uma câmera LPR nova (somente equipamento — não atualiza status no banco). */
  syncAllVehiclePlatesToCameraFireAndForget(
    cameraId: string,
    companyId: string,
  ): void {
    void this.enqueueCameraFromActivation(cameraId, companyId).catch((e) => {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'string'
            ? e
            : String(e);
      this.log.error(
        `syncAllVehiclePlatesToCamera camera=${cameraId}: ${msg}`,
      );
    });
  }

  private async enqueueCameraFromActivation(
    cameraId: string,
    companyId: string,
  ): Promise<void> {
    const camera = await camerasQueries.getCameraIfEligibleForLprPlateSync(
      this.database.db,
      cameraId,
      companyId,
    );
    if (!camera) return;
    await this.enqueueCameraJob(camera.clientId, cameraId, true);
  }

  private async runSyncAllVehiclePlatesToCamera(
    cameraId: string,
    companyId: string,
  ): Promise<void> {
    const camera = await camerasQueries.getCameraIfEligibleForLprPlateSync(
      this.database.db,
      cameraId,
      companyId,
    );
    if (!camera) return;

    const rows = await vehiclesQueries.listVehiclesForLprPlateSync(
      this.database.db,
      camera.clientId,
    );

    const cipher = createReaderCredentialsCipher(
      this.configService.get('READER_ENCRYPTION_KEY', { infer: true }),
    );
    const plain = toPlainCameraCredential(
      camera,
      cipher.decrypt(camera.passwordEncrypted),
    );

    for (const v of rows) {
      const pl = v.plate.trim();
      if (!pl) continue;
      try {
        await intelbrasInsertPlate(
          plain,
          pl,
          (v.driverName ?? '').trim() || 'CONDUTOR',
          v.color,
        );
      } catch (e) {
        const raw =
          e instanceof Error
            ? e.message
            : typeof e === 'string'
              ? e
              : String(e);
        this.log.warn(
          `Ativação LPR bulk cam=${camera.name} plate=${pl}: ${raw}`,
        );
      }
    }
  }

  async enqueueAllPendingVehicles(
    user: JwtPayload,
    clientId: string,
  ): Promise<string[]> {
    if (user.role === 'client_admin' || user.role === 'client_operator') {
      this.ensureClientTenant(user);
    } else {
      await this.ensureCompanyCanAccessClient(user, clientId);
    }
    const rows = await vehiclesQueries.listVehiclesPendingLprSync(
      this.database.db,
      clientId,
    );
    const jobIds: string[] = [];
    for (const row of rows) {
      const job = await this.enqueueVehicleJob(
        clientId,
        row.id,
        {
          plate: row.plate,
          ownerDisplayName: row.driverName ?? 'CONDUTOR',
          vehicleColor: row.color,
          logContext: `batch vehicle=${row.id}`,
        },
        user.sub,
      );
      jobIds.push(job.jobId);
    }
    return jobIds;
  }

  async syncAllPendingForCompany(
    user: JwtPayload,
    clientId: string,
    emit: (e: LprPlateSyncProgressEvent) => void,
  ) {
    await this.ensureCompanyCanAccessClient(user, clientId);
    return this.syncAllPending(clientId, emit);
  }

  async syncAllPendingForClientTenant(
    user: JwtPayload,
    emit: (e: LprPlateSyncProgressEvent) => void,
  ) {
    const clientId = this.ensureClientTenant(user);
    return this.syncAllPending(clientId, emit);
  }

  private async syncAllPending(
    clientId: string,
    emit: (e: LprPlateSyncProgressEvent) => void,
  ): Promise<void> {
    const rows = await vehiclesQueries.listVehiclesPendingLprSync(
      this.database.db,
      clientId,
    );
    emit({ type: 'start', total: rows.length });
    for (const r of rows) {
      try {
        await this.syncVehiclePlateOnCameras({
          clientId,
          vehicleId: r.id,
          plate: r.plate,
          ownerDisplayName: r.driverName ?? 'CONDUTOR',
          vehicleColor: r.color,
          logContext: `batch vehicle=${r.id}`,
        });
        const fresh = await vehiclesQueries.vehicleGetWithDriver(
          this.database.db,
          r.id,
          clientId,
        );
        const ok = fresh?.lprSyncStatus === 'synced';
        emit({
          type: 'item',
          vehicleId: r.id,
          plate: r.plate,
          ok,
          error: ok ? undefined : (fresh?.lprSyncError ?? undefined),
        });
      } catch (e) {
        emit({
          type: 'item',
          vehicleId: r.id,
          plate: r.plate,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    emit({ type: 'done' });
  }
}
