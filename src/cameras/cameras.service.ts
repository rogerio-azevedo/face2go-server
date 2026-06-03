import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { createReaderCredentialsCipher } from '../common/crypto/reader-credentials.cipher';
import type { FeatureSlug } from '../common/features.constants';
import type { EnvVars } from '../config/env.validation';
import { DatabaseService } from '../database/database.service';
import * as camerasQueries from '../database/queries/cameras.queries';
import { LprListenerService } from '../lpr-listener/lpr-listener.service';
import { LprPlateSyncService } from '../lpr-plate-sync/lpr-plate-sync.service';
import {
  formatCameraLprPlateError,
  intelbrasGetDevicePlates,
  intelbrasSearchDevicePlates,
  toPlainCameraCredential,
} from '../lpr-plate-sync/intelbras-lpr-device.client';
import {
  PermissionsService } from '../permissions/permissions.service';
import {
  createCameraSchema,
  updateCameraSchema,
} from '../validation/cameras.schema';
import { zodFirstMessage } from '../validation/zod-utils';

const toggleActiveSchema = z.object({
  isActive: z.boolean(),
});

@Injectable()
export class CamerasService {
  constructor(
    private readonly database: DatabaseService,
    private readonly permissionsService: PermissionsService,
    private readonly lprListener: LprListenerService,
    private readonly lprPlateSync: LprPlateSyncService,
    private readonly configService: ConfigService<EnvVars, true>,
  ) {}

  private ensureCompany(user: JwtPayload): string {
    const companyId = user.companyId ?? undefined;
    if (!companyId) throw new ForbiddenException('Sem permissão.');
    return companyId;
  }

  async list(user: JwtPayload, filterClientId?: string) {
    const companyId = this.ensureCompany(user);
    return this.ensureReadAccessThen(user, companyId, () =>
      camerasQueries.listCameras(this.database.db, companyId, filterClientId),
    );
  }

  async getMonitorStatus(user: JwtPayload, filterClientId?: string) {
    const companyId = this.ensureCompany(user);
    return this.ensureReadAccessThen(user, companyId, () =>
      this.lprListener.getMonitorReportForCompany(companyId, filterClientId),
    );
  }

  async getDevicePlates(
    user: JwtPayload,
    cameraId: string,
    limit: number,
    offset: number,
    search?: string,
  ) {
    const companyId = this.ensureCompany(user);
    return this.ensureReadAccessThen(user, companyId, async () => {
      const row = await camerasQueries.getCameraIfEligibleForLprPlateSync(
        this.database.db,
        cameraId,
        companyId,
      );
      if (!row) {
        throw new NotFoundException(
          'Câmera não encontrada ou indisponível para esta operação (ativo, LPR Intelbras e credenciais).',
        );
      }

      const cipher = createReaderCredentialsCipher(
        this.configService.get('READER_ENCRYPTION_KEY', { infer: true }),
      );
      const plainPassword = cipher.decrypt(row.passwordEncrypted);
      const camera = toPlainCameraCredential(row, plainPassword);

      try {
        if (search) {
          return await intelbrasSearchDevicePlates(
            camera,
            search,
            limit,
            offset,
          );
        }
        return await intelbrasGetDevicePlates(camera, limit, offset);
      } catch (e: unknown) {
        throw new BadRequestException(
          formatCameraLprPlateError(camera.name, e),
        );
      }
    });
  }

  private async ensureReadAccessThen<T>(
    user: JwtPayload,
    companyId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (user.role === 'company_admin') {
      return fn();
    }
    if (user.role === 'company_operator') {
      const ok =
        await this.permissionsService.evaluateCompanyFeatureAction(
          user.role,
          user.companyUserId,
          'clients' as FeatureSlug,
          'can_read',
        );
      if (!ok) throw new ForbiddenException('Sem permissão.');
      return fn();
    }
    throw new ForbiddenException('Sem permissão.');
  }

  async create(user: JwtPayload, body: unknown) {
    if (user.role !== 'company_admin') {
      throw new ForbiddenException('Sem permissão.');
    }
    const companyId = this.ensureCompany(user);
    const parsed = createCameraSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(zodFirstMessage(parsed.error));
    const d = parsed.data;
    const cipher = createReaderCredentialsCipher(
      this.configService.get('READER_ENCRYPTION_KEY', { infer: true }),
    );

    const passwordEncrypted = d.password ? cipher.encrypt(d.password) : null;
    const username = d.username ?? null;

    const row = await camerasQueries.createCamera(this.database.db, {
      companyId,
      clientId: d.clientId,
      type: d.type,
      direction: d.direction ?? null,
      brand: d.brand,
      name: d.name,
      description: d.description ?? null,
      ip: d.ip,
      port: d.port,
      serialNumber: d.serialNumber ?? null,
      model: d.model ?? null,
      location: d.location ?? null,
      deviceId: d.deviceId ?? null,
      username,
      passwordEncrypted,
      isActive: d.isActive,
    });
    if (!row) throw new BadRequestException('Cliente inválido para a empresa.');
    return camerasQueries.camerasRowToPublic(row);
  }

  async update(user: JwtPayload, cameraId: string, body: unknown) {
    if (user.role !== 'company_admin') {
      throw new ForbiddenException('Sem permissão.');
    }
    const companyId = this.ensureCompany(user);
    const parsed = updateCameraSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(zodFirstMessage(parsed.error));

    const d = parsed.data;
    if (
      d.clientId === undefined &&
      d.type === undefined &&
      d.direction === undefined &&
      d.brand === undefined &&
      d.name === undefined &&
      d.description === undefined &&
      d.ip === undefined &&
      d.port === undefined &&
      d.serialNumber === undefined &&
      d.model === undefined &&
      d.location === undefined &&
      d.deviceId === undefined &&
      d.isActive === undefined &&
      d.username === undefined &&
      d.password === undefined
    ) {
      throw new BadRequestException('Nada para atualizar.');
    }

    const existing = await camerasQueries.getCameraById(
      this.database.db,
      cameraId,
      companyId,
    );
    if (!existing) throw new NotFoundException('Câmera não encontrada.');

    const cipher = createReaderCredentialsCipher(
      this.configService.get('READER_ENCRYPTION_KEY', { infer: true }),
    );

    const patch: camerasQueries.CameraUpdateInput = {
      ...(d.clientId !== undefined ? { clientId: d.clientId } : {}),
      ...(d.type !== undefined ? { type: d.type } : {}),
      ...(d.direction !== undefined
        ? { direction: d.direction ?? null }
        : {}),
      ...(d.brand !== undefined ? { brand: d.brand } : {}),
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.description !== undefined
        ? { description: d.description ?? null }
        : {}),
      ...(d.ip !== undefined ? { ip: d.ip } : {}),
      ...(d.port !== undefined ? { port: d.port } : {}),
      ...(d.serialNumber !== undefined
        ? { serialNumber: d.serialNumber ?? null }
        : {}),
      ...(d.model !== undefined ? { model: d.model ?? null } : {}),
      ...(d.location !== undefined ? { location: d.location ?? null } : {}),
      ...(d.deviceId !== undefined
        ? { deviceId: d.deviceId ?? null }
        : {}),
      ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      ...(d.username !== undefined ? { username: d.username ?? null } : {}),
    };

    if (d.password !== undefined) {
      if (!d.password) {
        patch.passwordEncrypted = null;
      } else {
        patch.passwordEncrypted = cipher.encrypt(d.password);
      }
    }

    const row = await camerasQueries.updateCamera(
      this.database.db,
      cameraId,
      companyId,
      patch,
    );
    if (!row) throw new BadRequestException('Cliente inválido.');
    return camerasQueries.camerasRowToPublic(row);
  }

  async setActive(user: JwtPayload, cameraId: string, body: unknown) {
    if (user.role !== 'company_admin') {
      throw new ForbiddenException('Sem permissão.');
    }
    const companyId = this.ensureCompany(user);

    const parsed = toggleActiveSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(zodFirstMessage(parsed.error));

    const row = await camerasQueries.setCameraActive(
      this.database.db,
      cameraId,
      companyId,
      parsed.data.isActive,
    );
    if (!row) throw new NotFoundException('Câmera não encontrada.');
    const pub = camerasQueries.camerasRowToPublic(row);
    if (
      parsed.data.isActive &&
      pub.type === 'lpr' &&
      pub.brand?.trim().toLowerCase() === 'intelbras'
    ) {
      this.lprPlateSync.syncAllVehiclePlatesToCameraFireAndForget(
        cameraId,
        companyId,
      );
    }
    return pub;
  }
}
