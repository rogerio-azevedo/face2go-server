import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import * as rebuildQueries from '../database/queries/device-reader-rebuild.queries';
import * as personReaderSyncQueries from '../database/queries/person-reader-sync.queries';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as studentsQueries from '../database/queries/students.queries';
import type { FaceSyncEntityKind } from '../device-sync-queue/device-sync-queue.types';
import { ALWAYS_TIME_ZONE_INDEX } from './intelbras-time-zone.constants';
import { AccessTimeZoneService } from './access-time-zone.service';

export type RebuildPerson = {
  id: string;
  name: string;
  faceId: number;
  photoKey: string;
  entityKind: FaceSyncEntityKind;
  timeSectionIds: number[];
  validFrom?: Date;
  validUntil?: Date;
};

type PendingRow = {
  id: string;
  name: string;
  faceId: number;
  photoKey: string;
  entityKind: FaceSyncEntityKind;
  validFrom?: Date;
  validUntil?: Date;
};

@Injectable()
export class FaceReaderRebuildService {
  constructor(
    private readonly database: DatabaseService,
    private readonly accessTimeZone: AccessTimeZoneService,
  ) {}

  async listPeopleToSync(
    clientId: string,
    readerId: string,
    options?: { skipSynced?: boolean },
  ): Promise<RebuildPerson[]> {
    const skipSynced = options?.skipSynced !== false;
    const [
      members,
      regs,
      invites,
      schoolStudents,
      schoolResponsibles,
      alreadySynced,
    ] = await Promise.all([
      rebuildQueries.listMembersWithFaceByClient(this.database.db, clientId),
      rebuildQueries.listApprovedRegistrationsWithFaceByClient(
        this.database.db,
        clientId,
      ),
      rebuildQueries.listActiveInvitesWithFaceByClient(
        this.database.db,
        clientId,
      ),
      rebuildQueries.listStudentsWithFaceByClient(this.database.db, clientId),
      rebuildQueries.listResponsiblesWithFaceByClient(
        this.database.db,
        clientId,
      ),
      skipSynced
        ? personReaderSyncQueries.listSyncedFaceIdsByReader(
            this.database.db,
            clientId,
            readerId,
          )
        : Promise.resolve(new Set<number>()),
    ]);

    const pending: PendingRow[] = [];
    const seen = new Set<number>();

    const push = (
      row: {
        id: string;
        name: string | null;
        faceId: number | null;
        photoKey: string | null;
      },
      entityKind: FaceSyncEntityKind,
      extra?: { validFrom?: Date; validUntil?: Date },
    ) => {
      if (row.faceId == null || !row.photoKey) return;
      if (alreadySynced.has(row.faceId) || seen.has(row.faceId)) return;
      seen.add(row.faceId);
      pending.push({
        id: row.id,
        name: row.name?.trim() || 'USUARIO',
        faceId: row.faceId,
        photoKey: row.photoKey,
        entityKind,
        validFrom: extra?.validFrom,
        validUntil: extra?.validUntil,
      });
    };

    for (const row of members) push(row, 'member');
    for (const row of schoolStudents) push(row, 'student');
    for (const row of schoolResponsibles) push(row, 'responsible');
    for (const row of regs) push(row, 'registration');
    for (const row of invites) {
      push({ ...row, name: row.name?.trim() || 'VISITANTE' }, 'invite_guest', {
        validFrom: row.validFrom ?? undefined,
        validUntil: row.validUntil ?? undefined,
      });
    }

    const people: RebuildPerson[] = [];
    for (const row of pending) {
      people.push({
        ...row,
        timeSectionIds: await this.resolveTimeSections(clientId, row),
      });
    }
    return people;
  }

  async listSchoolBatchToSync(
    clientId: string,
    entityKind: 'student' | 'responsible',
  ): Promise<RebuildPerson[]> {
    const rows =
      entityKind === 'student'
        ? await studentsQueries.listStudentsForGlobalSync(
            this.database.db,
            clientId,
          )
        : await responsiblesQueries.listResponsiblesForGlobalSync(
            this.database.db,
            clientId,
          );
    const people: RebuildPerson[] = [];
    for (const row of rows) {
      const pending: PendingRow = {
        id: row.id,
        name: row.name,
        faceId: row.faceId,
        photoKey: row.photoKey,
        entityKind,
      };
      people.push({
        ...pending,
        timeSectionIds: await this.resolveTimeSections(clientId, pending),
      });
    }
    return people;
  }

  private resolveTimeSections(clientId: string, row: PendingRow) {
    if (row.entityKind === 'member') {
      return this.accessTimeZone.resolveMemberTimeSections(clientId, row.id);
    }
    if (row.entityKind === 'student') {
      return this.accessTimeZone.resolveStudentTimeSections(clientId, row.id);
    }
    if (row.entityKind === 'responsible') {
      return this.accessTimeZone.resolveResponsibleTimeSections(
        clientId,
        row.id,
      );
    }
    return Promise.resolve([ALWAYS_TIME_ZONE_INDEX]);
  }
}
