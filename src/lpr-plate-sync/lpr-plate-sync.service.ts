import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { createReaderCredentialsCipher } from '../common/crypto/reader-credentials.cipher';
import type { FeatureSlug } from '../common/features.constants';
import type { EnvVars } from '../config/env.validation';
import { DatabaseService } from '../database/database.service';
import * as camerasQueries from '../database/queries/cameras.queries';
import * as clientsQueries from '../database/queries/clients.queries';
import * as vehiclesQueries from '../database/queries/vehicles.queries';
import { PermissionsService } from '../permissions/permissions.service';
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
      const ok =
        await this.permissionsService.evaluateCompanyFeatureAction(
          user.role,
          user.companyUserId,
          'clients' as FeatureSlug,
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

    const cams =
      await camerasQueries.listCamerasForLprPlateSyncByClient(
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
            e instanceof Error ? e.message : typeof e === 'string' ? e : String(e);
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
  async syncVehiclePlateOnCameras(params: {
    clientId: string;
    vehicleId: string;
    plate: string;
    ownerDisplayName: string;
    vehicleColor?: string | null;
    logContext?: string;
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

    const cams =
      await camerasQueries.listCamerasForLprPlateSyncByClient(
        this.database.db,
        clientId,
      );

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
            e instanceof Error ? e.message : typeof e === 'string' ? e : String(e);
          this.log.warn(
            `${logPrefix}LPR sync plate=${pl} cam=${r.name}: ${raw}`,
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
        ? `Sincronizado parcialmente (${cams.length - failures.length} de ${cams.length} câmera(s)).`
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
  ): Promise<void> {
    const pl = plate.trim();
    if (!pl) return;

    const cams =
      await camerasQueries.listCamerasForLprPlateSyncByClient(
        this.database.db,
        clientId,
      );
    if (cams.length === 0) return;

    const cipher = createReaderCredentialsCipher(
      this.configService.get('READER_ENCRYPTION_KEY', { infer: true }),
    );
    const logPrefix = logContext ? `${logContext} ` : '';

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
            e instanceof Error ? e.message : typeof e === 'string' ? e : String(e);
          this.log.warn(`${logPrefix}LPR remove plate=${pl} cam=${r.name}: ${raw}`);
        }
      }),
    );
  }

  async syncVehicleForCompany(user: JwtPayload, clientId: string, vehicleId: string) {
    await this.ensureCompanyCanAccessClient(user, clientId);

    const v = await vehiclesQueries.vehicleGetWithDriver(
      this.database.db,
      vehicleId,
      clientId,
    );
    if (!v) throw new NotFoundException('Veículo não encontrado.');

    return this.syncVehiclePlateOnCameras({
      clientId,
      vehicleId,
      plate: v.plate,
      ownerDisplayName: v.driverName ?? 'CONDUTOR',
      vehicleColor: v.color,
      logContext: `vehicle=${vehicleId}`,
    });
  }

  async syncVehicleForClientTenant(user: JwtPayload, vehicleId: string) {
    const clientId = this.ensureClientTenant(user);
    const v = await vehiclesQueries.vehicleGetWithDriver(
      this.database.db,
      vehicleId,
      clientId,
    );
    if (!v) throw new NotFoundException('Veículo não encontrado.');
    return this.syncVehiclePlateOnCameras({
      clientId,
      vehicleId,
      plate: v.plate,
      ownerDisplayName: v.driverName ?? 'CONDUTOR',
      vehicleColor: v.color,
      logContext: `vehicle=${vehicleId}`,
    });
  }

  /** Envia todas as placas ao ativar uma câmera LPR nova (somente equipamento — não atualiza status no banco). */
  syncAllVehiclePlatesToCameraFireAndForget(
    cameraId: string,
    companyId: string,
  ): void {
    void this.runSyncAllVehiclePlatesToCamera(cameraId, companyId).catch((e) => {
      const msg =
        e instanceof Error ? e.message : typeof e === 'string' ? e : String(e);
      this.log.error(`syncAllVehiclePlatesToCamera camera=${cameraId}: ${msg}`);
    });
  }

  private async runSyncAllVehiclePlatesToCamera(
    cameraId: string,
    companyId: string,
  ): Promise<void> {
    const camera =
      await camerasQueries.getCameraIfEligibleForLprPlateSync(
        this.database.db,
        cameraId,
        companyId,
      );
    if (!camera) return;

    const rows =
      await vehiclesQueries.listVehiclesForLprPlateSync(
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
          e instanceof Error ? e.message : typeof e === 'string' ? e : String(e);
        this.log.warn(
          `Ativação LPR bulk cam=${camera.name} plate=${pl}: ${raw}`,
        );
      }
    }
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
    const rows =
      await vehiclesQueries.listVehiclesPendingLprSync(
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
          error: ok ? undefined : fresh?.lprSyncError ?? undefined,
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
