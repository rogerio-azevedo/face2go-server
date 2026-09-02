import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { createReaderCredentialsCipher } from '../common/crypto/reader-credentials.cipher';
import type { EnvVars } from '../config/env.validation';
import { DatabaseService } from '../database/database.service';
import * as readersQueries from '../database/queries/readers.queries';
import { toPlainReaderCredential } from '../integrations/intelbras/intelbras-device.client';
import { INTELBRAS_V2_MIN_BUILD } from './intelbras-push.capability';
import {
  intelbrasGetConfig,
  intelbrasGetSoftwareVersion,
  intelbrasSetConfig,
} from './intelbras-push.config.client';

export type IntelbrasPushMode = 'v1' | 'v2';

export type PushTarget = {
  address: string;
  port: number;
  https: boolean;
  path: string;
};

const PROD_API_FALLBACK = 'https://api.face2go.com.br';

function parsePublicApiUrl(raw?: string): URL | null {
  const value = raw?.trim() || '';
  if (!value) {
    return null;
  }
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function resolvePushTarget(
  readerId: string,
  apiUrl?: string,
): PushTarget {
  const url =
    parsePublicApiUrl(apiUrl) ??
    parsePublicApiUrl(process.env.API_URL) ??
    parsePublicApiUrl(process.env.APP_PUBLIC_URL) ??
    (process.env.NODE_ENV === 'production'
      ? parsePublicApiUrl(PROD_API_FALLBACK)
      : null);
  if (!url) {
    throw new BadRequestException(
      'API_URL (ou APP_PUBLIC_URL) não configurada — o leitor precisa de um host alcançável',
    );
  }
  const host = url.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    throw new BadRequestException(
      'API_URL aponta para localhost — o leitor não alcança esse host',
    );
  }
  const https = url.protocol === 'https:';
  const port = url.port ? Number(url.port) : https ? 443 : 80;
  return {
    address: host,
    port,
    https,
    path: `/device-events/facial/${readerId}`,
  };
}

@Injectable()
export class IntelbrasPushProvisionService {
  private readonly logger = new Logger(IntelbrasPushProvisionService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly configService: ConfigService<EnvVars, true>,
  ) {}

  async preview(companyId: string, readerId: string) {
    const reader = await this.loadIntelbrasReader(companyId, readerId);
    const [version, modeCfg, modeCfgII, pictureUpload] = await Promise.all([
      intelbrasGetSoftwareVersion(reader),
      intelbrasGetConfig(reader, 'Intelbras_ModeCfg').catch(
        (): Record<string, string> => ({}),
      ),
      intelbrasGetConfig(reader, 'Intelbras_ModeCfgII').catch(
        (): Record<string, string> => ({}),
      ),
      intelbrasGetConfig(reader, 'PictureHttpUpload').catch(
        (): Record<string, string> => ({}),
      ),
    ]);
    const suggestedMode = this.detectMode(version.buildDate);
    return {
      readerId,
      firmwareBuildDate: version.buildDate,
      suggestedMode,
      current: {
        deviceMode:
          typeof modeCfg['Intelbras_ModeCfg.DeviceMode'] === 'string'
            ? modeCfg['Intelbras_ModeCfg.DeviceMode']
            : null,
        modeCfgII,
        pictureUpload,
      },
      target: this.safeTarget(readerId),
    };
  }

  async provision(
    companyId: string,
    readerId: string,
    mode?: IntelbrasPushMode,
  ): Promise<{
    readerId: string;
    mode: IntelbrasPushMode;
    firmwareBuildDate: number | null;
    target: PushTarget;
    applied: boolean;
    raw: string;
  }> {
    const reader = await this.loadIntelbrasReader(companyId, readerId);
    const version = await intelbrasGetSoftwareVersion(reader);
    const chosen = mode ?? this.detectMode(version.buildDate);
    const target = resolvePushTarget(readerId, this.publicApiUrl());

    this.logger.log(
      `[IntelbrasPush] provision ${readerId} mode=${chosen} host=${target.address}:${target.port}${target.path}`,
    );

    const first = await this.applyMode(reader, chosen, target);
    if (first.ok) {
      return {
        readerId,
        mode: chosen,
        firmwareBuildDate: version.buildDate,
        target,
        applied: true,
        raw: first.raw.trim(),
      };
    }

    if (chosen === 'v2') {
      this.logger.warn(
        `[IntelbrasPush] setConfig 2.0 falhou em ${readerId}, tentando 1.0`,
      );
      const fallback = await this.applyMode(reader, 'v1', target);
      return {
        readerId,
        mode: 'v1',
        firmwareBuildDate: version.buildDate,
        target,
        applied: fallback.ok,
        raw: fallback.raw.trim() || first.raw.trim(),
      };
    }

    return {
      readerId,
      mode: chosen,
      firmwareBuildDate: version.buildDate,
      target,
      applied: false,
      raw: first.raw.trim(),
    };
  }

  async provisionIntelbrasForClient(
    companyId: string,
    clientId?: string,
  ): Promise<{
    results: Array<{
      readerId: string;
      name: string;
      applied: boolean;
      mode: IntelbrasPushMode;
      raw: string;
    }>;
  }> {
    const rows = await readersQueries.listIntelbrasReadersForProvision(
      this.database.db,
      companyId,
      clientId,
    );
    const results: Array<{
      readerId: string;
      name: string;
      applied: boolean;
      mode: IntelbrasPushMode;
      raw: string;
    }> = [];
    for (const row of rows) {
      try {
        const out = await this.provision(companyId, row.id);
        results.push({
          readerId: row.id,
          name: row.name,
          applied: out.applied,
          mode: out.mode,
          raw: out.raw,
        });
      } catch (error) {
        results.push({
          readerId: row.id,
          name: row.name,
          applied: false,
          mode: 'v1',
          raw: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { results };
  }

  private detectMode(buildDate: number | null): IntelbrasPushMode {
    if (buildDate != null && buildDate >= INTELBRAS_V2_MIN_BUILD) {
      return 'v2';
    }
    return 'v1';
  }

  private publicApiUrl(): string | undefined {
    return (
      this.configService.get('API_URL', { infer: true }) ??
      this.configService.get('APP_PUBLIC_URL', { infer: true })
    );
  }

  private safeTarget(readerId: string): PushTarget | null {
    try {
      return resolvePushTarget(readerId, this.publicApiUrl());
    } catch {
      return null;
    }
  }

  private async applyMode(
    reader: ReturnType<typeof toPlainReaderCredential>,
    mode: IntelbrasPushMode,
    target: PushTarget,
  ) {
    const https = target.https ? 'true' : 'false';
    if (mode === 'v2') {
      const cfg = await intelbrasSetConfig(reader, {
        'Intelbras_ModeCfgII.UploadServerList[0].Enable': 'true',
        'Intelbras_ModeCfgII.UploadServerList[0].Address': target.address,
        'Intelbras_ModeCfgII.UploadServerList[0].Port': String(target.port),
        'Intelbras_ModeCfgII.UploadServerList[0].Uploadpath': target.path,
        'Intelbras_ModeCfgII.UploadServerList[0].OfflineRetransmission': 'true',
        'Intelbras_ModeCfgII.UploadServerList[0].ReportPicture': 'true',
        'Intelbras_ModeCfgII.UploadServerList[0].EventType[0]':
          'UserManagerInfo',
        'Intelbras_ModeCfgII.UploadServerList[0].EventType[1]': 'AccessControl',
        'Intelbras_ModeCfgII.UploadServerList[0].EventType[2]': 'DoorStatus',
        'Intelbras_ModeCfgII.UploadServerList[0].EventType[3]': 'AlarmEvent',
        'Intelbras_ModeCfgII.UploadServerList[0].EventType[4]': 'SystemEvent',
        'Intelbras_ModeCfgII.UploadServerList[0].HttpsEnable': https,
        'Intelbras_ModeCfgII.OnlineAuthServer.Enable': 'false',
      });
      if (!cfg.ok) {
        return cfg;
      }
      const content = await intelbrasSetConfig(reader, {
        'Intelbras_UploadContentType.ContentType': 'jsonv2',
      });
      if (!content.ok) {
        const jsonFallback = await intelbrasSetConfig(reader, {
          'Intelbras_UploadContentType.ContentType': 'json',
        });
        if (!jsonFallback.ok) {
          return jsonFallback;
        }
      }
      return intelbrasSetConfig(reader, {
        'Intelbras_ModeCfg.DeviceMode': '3',
      });
    }

    return intelbrasSetConfig(reader, {
      'PictureHttpUpload.Enable': 'true',
      'PictureHttpUpload.UploadServerList[0].Address': target.address,
      'PictureHttpUpload.UploadServerList[0].Port': String(target.port),
      'PictureHttpUpload.UploadServerList[0].Uploadpath': target.path,
      'PictureHttpUpload.UploadServerList[0].HttpsEnable': https,
      'HTTPUploadPic.Enable': 'true',
      'Intelbras_ModeCfg.DeviceMode': '1',
    });
  }

  private async loadIntelbrasReader(companyId: string, readerId: string) {
    const row = await readersQueries.getReaderWithCredentialsById(
      this.database.db,
      readerId,
      companyId,
    );
    if (!row) {
      throw new NotFoundException('Leitor facial não encontrado');
    }
    if ((row.brand ?? 'intelbras') === 'hikvision') {
      throw new BadRequestException(
        'Este endpoint é só para Intelbras — Hikvision fica em outro plano',
      );
    }
    if (!row.username?.trim() || !row.passwordEncrypted?.trim()) {
      throw new BadRequestException('Credenciais do leitor não configuradas');
    }
    const cipher = createReaderCredentialsCipher(
      this.configService.get('READER_ENCRYPTION_KEY', { infer: true }),
    );
    return toPlainReaderCredential(
      {
        id: row.id,
        name: row.name,
        brand: row.brand ?? 'intelbras',
        ip: row.ip,
        port: row.port,
        username: row.username,
        passwordEncrypted: row.passwordEncrypted,
      },
      cipher.decrypt(row.passwordEncrypted),
    );
  }
}
