import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import type { EnvVars } from '../config/env.validation';
import { DatabaseService } from '../database/database.service';
import { toHikvisionConnection } from '../integrations/hikvision';
import { hikvisionGetDeviceInfo } from '../integrations/hikvision/hikvision-device-info.client';
import {
  intelbrasGetDeviceType,
  intelbrasGetSoftwareVersion,
  parseIntelbrasFirmwareLabel,
} from '../intelbras-push/intelbras-push.config.client';
import { PermissionsService } from '../permissions/permissions.service';
import {
  assertCompanyOperatorAction,
  ensureCompanyId,
  loadActiveDeviceReader,
} from './readers-device-access';
import { ReadersDeviceInfoRepository } from './readers-device-info.repository';

type CollectedReaderDeviceInfo = {
  model: string | null;
  serialNumber: string | null;
  firmwareVersion: string | null;
};

export type ReaderDeviceInfoResponse = CollectedReaderDeviceInfo & {
  syncedAt: Date;
};

function limited(value: string | null, max: number): string | null {
  const normalized = value?.replaceAll('\0', '').trim();
  return normalized ? normalized.slice(0, max) : null;
}

function safeDeviceError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (
    raw === 'O equipamento não informou modelo, firmware ou número de série.'
  ) {
    return raw;
  }
  if (/offline|not online|não conectado/i.test(raw)) {
    return 'Leitor offline. Conecte o equipamento e tente novamente.';
  }
  if (/401|unauthorized|credencia|senha|authentication/i.test(raw)) {
    return 'O equipamento recusou as credenciais configuradas.';
  }
  return 'Não foi possível consultar as informações do equipamento.';
}

@Injectable()
export class ReadersDeviceInfoService {
  constructor(
    private readonly database: DatabaseService,
    private readonly configService: ConfigService<EnvVars, true>,
    private readonly permissionsService: PermissionsService,
    private readonly repository: ReadersDeviceInfoRepository,
  ) {}

  async refresh(
    user: JwtPayload,
    readerId: string,
  ): Promise<ReaderDeviceInfoResponse> {
    await assertCompanyOperatorAction(
      this.permissionsService,
      user,
      'can_read',
    );
    const companyId = ensureCompanyId(user);
    const reader = await loadActiveDeviceReader(
      this.database.db,
      this.configService,
      companyId,
      readerId,
    );

    try {
      const collected = await this.collect(reader.brand, reader.plain);
      const normalized = {
        model: limited(collected.model, 120),
        serialNumber: limited(collected.serialNumber, 120),
        firmwareVersion: limited(collected.firmwareVersion, 255),
      };
      if (
        !normalized.model &&
        !normalized.serialNumber &&
        !normalized.firmwareVersion
      ) {
        throw new BadGatewayException(
          'O equipamento não informou modelo, firmware ou número de série.',
        );
      }
      const syncedAt = new Date();
      const saved = await this.repository.saveSuccess(
        companyId,
        readerId,
        {
          ...(normalized.model ? { model: normalized.model } : {}),
          ...(normalized.serialNumber
            ? { serialNumber: normalized.serialNumber }
            : {}),
          ...(normalized.firmwareVersion
            ? { firmwareVersion: normalized.firmwareVersion }
            : {}),
        },
        syncedAt,
      );
      if (!saved) throw new NotFoundException('Leitor não encontrado.');
      return {
        model: saved.model,
        serialNumber: saved.serialNumber,
        firmwareVersion: saved.firmwareVersion,
        syncedAt: saved.deviceInfoSyncedAt ?? syncedAt,
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      const message =
        error instanceof BadGatewayException
          ? error.message
          : safeDeviceError(error);
      await this.repository.saveError(companyId, readerId, message);
      throw new BadGatewayException(message);
    }
  }

  private async collect(
    brand: string,
    reader: Parameters<typeof toHikvisionConnection>[0],
  ): Promise<CollectedReaderDeviceInfo> {
    if (brand === 'hikvision') {
      return hikvisionGetDeviceInfo(toHikvisionConnection(reader));
    }
    if (brand === 'intelbras') {
      const modelResponse: unknown = await intelbrasGetDeviceType(reader);
      const versionResponse: unknown =
        await intelbrasGetSoftwareVersion(reader);
      const model = typeof modelResponse === 'string' ? modelResponse : null;
      const rawVersion =
        versionResponse &&
        typeof versionResponse === 'object' &&
        'raw' in versionResponse &&
        typeof versionResponse.raw === 'string'
          ? versionResponse.raw
          : null;
      return {
        model,
        serialNumber: null,
        firmwareVersion: rawVersion
          ? parseIntelbrasFirmwareLabel(rawVersion)
          : null,
      };
    }
    throw new BadRequestException(
      'Consulta de informações não suportada para esta marca.',
    );
  }
}
