import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import type { EnvVars } from '../config/env.validation';
import { DatabaseService } from '../database/database.service';
import * as rebuildQueries from '../database/queries/device-reader-rebuild.queries';
import * as personReaderSyncQueries from '../database/queries/person-reader-sync.queries';
import { AccessTimeZoneService } from '../face-sync/access-time-zone.service';
import type { FaceSyncProgressEvent } from '../face-sync/face-sync.service';
import { FaceSyncService } from '../face-sync/face-sync.service';
import {
  intelbrasListAllDeviceUsers,
  intelbrasRemoveUsersFromReader,
} from '../face-sync/intelbras-device.client';
import { ALWAYS_TIME_ZONE_INDEX } from '../face-sync/intelbras-time-zone.constants';
import {
  hikvisionDeleteAllUsers,
  toHikvisionConnection,
} from '../integrations/hikvision';
import { PermissionsService } from '../permissions/permissions.service';
import { R2StorageService } from '../storage/r2-storage.service';
import {
  assertCompanyOperatorAction,
  assertNotSchoolClient,
  ensureCompanyId,
  loadActiveDeviceReader,
  type LoadedDeviceReader,
} from './readers-device-access';

const SSE_PING_MS = 15_000;

type RebuildPerson = {
  id: string;
  name: string;
  faceId: number;
  photoKey: string;
  timeSectionIds: number[];
  validFrom?: Date;
  validUntil?: Date;
};

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
    private readonly accessTimeZone: AccessTimeZoneService,
    private readonly r2: R2StorageService,
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

  async syncAllOnReader(
    user: JwtPayload,
    readerId: string,
    emit: (e: FaceSyncProgressEvent) => void,
  ): Promise<void> {
    const loaded = await this.prepare(user, readerId);
    const people = await this.listPeopleToSync(loaded.clientId, loaded.id);
    emit({ type: 'start', total: people.length });

    const pingTimer = setInterval(() => emit({ type: 'ping' }), SSE_PING_MS);
    try {
      for (const person of people) {
        try {
          const { buffer } = await this.r2.getObjectBytes(person.photoKey);
          const outcome = await this.faceSync.syncPersonOnReaders({
            clientId: loaded.clientId,
            faceId: person.faceId,
            name: person.name,
            imageBuffer: buffer,
            photoKey: person.photoKey,
            timeSectionIds: person.timeSectionIds,
            validFrom: person.validFrom,
            validUntil: person.validUntil,
            logContext: `reader-rebuild=${loaded.id}:${person.id}`,
            readerIds: [loaded.id],
            resetReaderProgress: false,
          });
          emit({
            type: 'item',
            registrationId: person.id,
            name: person.name,
            ok: outcome.deviceSyncStatus === 'synced',
            error: outcome.deviceSyncError ?? undefined,
          });
        } catch (e) {
          emit({
            type: 'item',
            registrationId: person.id,
            name: person.name,
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

  private async listPeopleToSync(
    clientId: string,
    readerId: string,
  ): Promise<RebuildPerson[]> {
    const [members, regs, invites] = await Promise.all([
      rebuildQueries.listMembersWithFaceByClient(this.database.db, clientId),
      rebuildQueries.listApprovedRegistrationsWithFaceByClient(
        this.database.db,
        clientId,
      ),
      rebuildQueries.listActiveInvitesWithFaceByClient(
        this.database.db,
        clientId,
      ),
    ]);

    const byFace = new Map<number, RebuildPerson>();

    for (const row of members) {
      if (row.faceId == null || !row.photoKey) continue;
      byFace.set(row.faceId, {
        id: row.id,
        name: row.name,
        faceId: row.faceId,
        photoKey: row.photoKey,
        timeSectionIds: await this.accessTimeZone.resolveMemberTimeSections(
          clientId,
          row.id,
        ),
      });
    }

    for (const row of regs) {
      if (row.faceId == null || !row.photoKey || byFace.has(row.faceId)) {
        continue;
      }
      byFace.set(row.faceId, {
        id: row.id,
        name: row.name ?? 'USUARIO',
        faceId: row.faceId,
        photoKey: row.photoKey,
        timeSectionIds: [ALWAYS_TIME_ZONE_INDEX],
      });
    }

    for (const row of invites) {
      if (row.faceId == null || !row.photoKey || byFace.has(row.faceId)) {
        continue;
      }
      byFace.set(row.faceId, {
        id: row.id,
        name: row.name?.trim() || 'VISITANTE',
        faceId: row.faceId,
        photoKey: row.photoKey,
        timeSectionIds: [ALWAYS_TIME_ZONE_INDEX],
        validFrom: row.validFrom,
        validUntil: row.validUntil,
      });
    }

    const alreadySynced =
      await personReaderSyncQueries.listSyncedFaceIdsByReader(
        this.database.db,
        clientId,
        readerId,
      );
    return [...byFace.values()].filter(
      (person) => !alreadySynced.has(person.faceId),
    );
  }
}
