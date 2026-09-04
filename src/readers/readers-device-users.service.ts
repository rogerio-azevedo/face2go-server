import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import type { EnvVars } from '../config/env.validation';
import { DatabaseService } from '../database/database.service';
import * as deviceUserReconcileQueries from '../database/queries/device-user-reconcile.queries';
import * as personReaderSyncQueries from '../database/queries/person-reader-sync.queries';
import {
  intelbrasGetDeviceUsers,
  intelbrasGetFaceImage,
  intelbrasListAllDeviceUsers,
  intelbrasRemoveUsersFromReader,
  intelbrasSearchDeviceUsers,
} from '../face-sync/intelbras-device.client';
import {
  hikvisionDeleteUsers,
  hikvisionGetDeviceUsers,
  hikvisionGetFaceImage,
  hikvisionListAllDeviceUsers,
  toHikvisionConnection,
} from '../integrations/hikvision';
import { PermissionsService } from '../permissions/permissions.service';
import {
  enrichDeviceUserRecords,
  parseDeviceUserFaceId,
  type DeviceUserRecord,
} from './device-user-reconcile.util';
import {
  assertCompanyOperatorAction,
  ensureCompanyId,
  loadActiveDeviceReader,
  type LoadedDeviceReader,
} from './readers-device-access';

export type DeviceUsersBatchDeleteResult = {
  deleted: string[];
  failed: { userId: string; error: string }[];
};

export type DeviceUsersRemoveOrphansResult = {
  scanned: number;
  orphans: number;
  deleted: string[];
  failed: { userId: string; error: string }[];
};

@Injectable()
export class ReadersDeviceUsersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly permissionsService: PermissionsService,
    private readonly configService: ConfigService<EnvVars, true>,
  ) {}

  private async enrichRecords(
    clientId: string,
    records: Array<{
      UserID: string;
      CardName: string;
      CardNo?: string;
      ValidDateStart?: string;
      ValidDateEnd?: string;
      HasFace?: boolean | null;
    }>,
  ): Promise<DeviceUserRecord[]> {
    const faceIds = records
      .map((row) => parseDeviceUserFaceId(row.UserID))
      .filter((id): id is number => id != null);
    const persons = await deviceUserReconcileQueries.listPersonsByFaceIds(
      this.database.db,
      clientId,
      faceIds,
    );
    return enrichDeviceUserRecords(records, persons);
  }

  private async deleteOnDevice(
    loaded: LoadedDeviceReader,
    userIds: string[],
  ): Promise<DeviceUsersBatchDeleteResult> {
    if (userIds.length === 0) return { deleted: [], failed: [] };

    if (loaded.brand === 'hikvision') {
      return hikvisionDeleteUsers(toHikvisionConnection(loaded.plain), userIds);
    }

    return intelbrasRemoveUsersFromReader(loaded.plain, userIds);
  }

  private async prepare(
    user: JwtPayload,
    readerId: string,
    action: 'can_read' | 'can_delete',
  ) {
    await assertCompanyOperatorAction(this.permissionsService, user, action);
    return loadActiveDeviceReader(
      this.database.db,
      this.configService,
      ensureCompanyId(user),
      readerId,
    );
  }

  private async resetSyncForDeleted(
    clientId: string,
    readerId: string,
    deletedUserIds: string[],
  ) {
    for (const userId of deletedUserIds) {
      const faceId = parseDeviceUserFaceId(userId);
      if (faceId == null) continue;
      await personReaderSyncQueries.deletePersonReaderSyncByFaceAndReader(
        this.database.db,
        clientId,
        faceId,
        readerId,
      );
    }
  }

  async getDeviceUsers(
    user: JwtPayload,
    readerId: string,
    limit: number,
    offset: number,
    search?: string,
  ) {
    const loaded = await this.prepare(user, readerId, 'can_read');

    try {
      if (loaded.brand === 'hikvision') {
        const resolved = await hikvisionGetDeviceUsers(
          toHikvisionConnection(loaded.plain),
          Math.min(Math.max(limit, 1), 500),
          Math.max(offset, 0),
          search?.trim(),
        );
        return {
          totalCount: resolved.totalCount,
          found: resolved.found,
          clientType: loaded.clientType,
          records: await this.enrichRecords(
            loaded.clientId,
            resolved.records.map((r) => ({
              UserID: r.userId,
              CardName: r.name,
              CardNo: r.cardNo ?? r.userId,
              ValidDateStart: r.validFrom ?? undefined,
              ValidDateEnd: r.validTo ?? undefined,
              HasFace: r.hasFace ?? null,
            })),
          ),
        };
      }

      const page = search
        ? await intelbrasSearchDeviceUsers(loaded.plain, search, limit, offset)
        : await intelbrasGetDeviceUsers(loaded.plain, limit, offset);
      return {
        ...page,
        clientType: loaded.clientType,
        records: await this.enrichRecords(loaded.clientId, page.records),
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro desconhecido';
      throw new BadRequestException('Falha ao comunicar com o leitor: ' + msg);
    }
  }

  async removeDeviceUser(user: JwtPayload, readerId: string, userId: string) {
    const loaded = await this.prepare(user, readerId, 'can_delete');

    try {
      const result = await this.deleteOnDevice(loaded, [userId]);
      if (result.failed[0]) {
        throw new Error(result.failed[0].error);
      }
      await this.resetSyncForDeleted(
        loaded.clientId,
        loaded.id,
        result.deleted,
      );
      return { success: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro desconhecido';
      throw new BadRequestException('Falha ao comunicar com o leitor: ' + msg);
    }
  }

  async batchDeleteDeviceUsers(
    user: JwtPayload,
    readerId: string,
    userIds: string[],
  ): Promise<DeviceUsersBatchDeleteResult> {
    const loaded = await this.prepare(user, readerId, 'can_delete');

    try {
      const result = await this.deleteOnDevice(loaded, userIds);
      await this.resetSyncForDeleted(
        loaded.clientId,
        loaded.id,
        result.deleted,
      );
      return result;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro desconhecido';
      throw new BadRequestException('Falha ao comunicar com o leitor: ' + msg);
    }
  }

  async removeOrphans(
    user: JwtPayload,
    readerId: string,
    dryRun: boolean,
  ): Promise<DeviceUsersRemoveOrphansResult> {
    const loaded = await this.prepare(user, readerId, 'can_delete');

    try {
      const deviceUsers =
        loaded.brand === 'hikvision'
          ? (
              await hikvisionListAllDeviceUsers(
                toHikvisionConnection(loaded.plain),
              )
            ).map((r) => r.userId)
          : (await intelbrasListAllDeviceUsers(loaded.plain)).map(
              (r) => r.UserID,
            );

      const knownFaceIds = await deviceUserReconcileQueries.listClientFaceIds(
        this.database.db,
        loaded.clientId,
      );
      const orphanIds = deviceUsers.filter((userId) => {
        const faceId = parseDeviceUserFaceId(userId);
        return faceId == null || !knownFaceIds.has(faceId);
      });

      if (dryRun) {
        return {
          scanned: deviceUsers.length,
          orphans: orphanIds.length,
          deleted: [],
          failed: [],
        };
      }

      const result = await this.deleteOnDevice(loaded, orphanIds);
      await this.resetSyncForDeleted(
        loaded.clientId,
        loaded.id,
        result.deleted,
      );
      return {
        scanned: deviceUsers.length,
        orphans: orphanIds.length,
        deleted: result.deleted,
        failed: result.failed,
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro desconhecido';
      throw new BadRequestException('Falha ao comunicar com o leitor: ' + msg);
    }
  }

  async getDeviceUserFace(user: JwtPayload, readerId: string, userId: string) {
    const loaded = await this.prepare(user, readerId, 'can_read');

    try {
      if (loaded.brand === 'hikvision') {
        return await hikvisionGetFaceImage(
          toHikvisionConnection(loaded.plain),
          userId,
        );
      }
      return await intelbrasGetFaceImage(loaded.plain, userId);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro desconhecido';
      throw new BadRequestException('Falha ao comunicar com o leitor: ' + msg);
    }
  }
}
