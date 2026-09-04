import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import type { EnvVars } from '../config/env.validation';
import { DatabaseService } from '../database/database.service';
import * as personReaderSyncQueries from '../database/queries/person-reader-sync.queries';
import { DeviceSyncQueueService } from '../device-sync-queue/device-sync-queue.service';
import { FaceSyncService } from '../face-sync/face-sync.service';
import {
  intelbrasListAllDeviceUsers,
  intelbrasRemoveUsersFromReader,
} from '../face-sync/intelbras-device.client';
import {
  hikvisionDeleteAllUsers,
  toHikvisionConnection,
} from '../integrations/hikvision';
import { PermissionsService } from '../permissions/permissions.service';
import {
  assertCompanyOperatorAction,
  assertNotSchoolClient,
  ensureCompanyId,
  loadActiveDeviceReader,
  type LoadedDeviceReader,
} from './readers-device-access';

export type DeviceUsersWipeAllResult = {
  strategy: 'hikvision-all' | 'hikvision-fallback' | 'intelbras-batch';
  deleted: number;
  failed: { userId: string; error: string }[];
};

@Injectable()
export class ReadersDeviceWipeSyncService {
  constructor(
    private readonly database: DatabaseService,
    private readonly permissionsService: PermissionsService,
    private readonly configService: ConfigService<EnvVars, true>,
    private readonly faceSync: FaceSyncService,
    private readonly queue: DeviceSyncQueueService,
  ) {}

  private async prepare(user: JwtPayload, readerId: string) {
    await assertCompanyOperatorAction(
      this.permissionsService,
      user,
      'can_delete',
    );
    const loaded = await loadActiveDeviceReader(
      this.database.db,
      this.configService,
      ensureCompanyId(user),
      readerId,
    );
    assertNotSchoolClient(loaded.clientType);
    return loaded;
  }

  async wipeAll(
    user: JwtPayload,
    readerId: string,
  ): Promise<DeviceUsersWipeAllResult> {
    const loaded = await this.prepare(user, readerId);

    try {
      const result = await this.wipeOnDevice(loaded);
      if (result.failed.length === 0) {
        await personReaderSyncQueries.deletePersonReaderSyncByReader(
          this.database.db,
          loaded.clientId,
          loaded.id,
        );
      }
      return result;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro desconhecido';
      throw new BadRequestException('Falha ao comunicar com o leitor: ' + msg);
    }
  }

  async enqueueSyncAllOnReader(
    user: JwtPayload,
    readerId: string,
    force = false,
  ) {
    await assertCompanyOperatorAction(
      this.permissionsService,
      user,
      'can_delete',
    );
    const loaded = await loadActiveDeviceReader(
      this.database.db,
      this.configService,
      ensureCompanyId(user),
      readerId,
    );
    return this.faceSync.enqueueReaderRebuildJob(
      loaded.clientId,
      loaded.id,
      force,
      user.sub,
    );
  }

  async getFaceReaderSyncStatus(user: JwtPayload, readerId: string) {
    await assertCompanyOperatorAction(
      this.permissionsService,
      user,
      'can_read',
    );
    const loaded = await loadActiveDeviceReader(
      this.database.db,
      this.configService,
      ensureCompanyId(user),
      readerId,
    );
    const rows = await this.queue.listActiveFaceReader(loaded.clientId);
    return {
      clientId: loaded.clientId,
      jobs: rows.map((row) => this.queue.toDto(row)),
    };
  }

  private async wipeOnDevice(
    loaded: LoadedDeviceReader,
  ): Promise<DeviceUsersWipeAllResult> {
    if (loaded.brand === 'hikvision') {
      const result = await hikvisionDeleteAllUsers(
        toHikvisionConnection(loaded.plain),
      );
      return {
        strategy:
          result.strategy === 'native' ? 'hikvision-all' : 'hikvision-fallback',
        deleted: result.deleted.length,
        failed: result.failed,
      };
    }

    const users = await intelbrasListAllDeviceUsers(loaded.plain);
    const userIds = users.map((row) => row.UserID);
    const result = await intelbrasRemoveUsersFromReader(loaded.plain, userIds);
    return {
      strategy: 'intelbras-batch',
      deleted: result.deleted.length,
      failed: result.failed,
    };
  }
}
