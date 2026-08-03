import { Injectable, Logger } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import * as membersQueries from '../database/queries/members.queries';
import * as peopleQueries from '../database/queries/people.queries';
import type {
  BondExclude,
  FaceBondRef,
  SharedFaceSnapshot,
} from '../database/queries/people.queries';
import * as registrationsQueries from '../database/queries/registrations.queries';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import { AccessTimeZoneService } from '../face-sync/access-time-zone.service';
import { FaceSyncService } from '../face-sync/face-sync.service';
import { isPortraitImageUsable } from '../storage/portrait-image.utils';
import { R2StorageService } from '../storage/r2-storage.service';

export type { BondExclude, SharedFaceSnapshot } from '../database/queries/people.queries';

@Injectable()
export class PersonProfileService {
  private readonly log = new Logger(PersonProfileService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly r2: R2StorageService,
    private readonly faceSync: FaceSyncService,
    private readonly accessTimeZone: AccessTimeZoneService,
  ) {}

  async findSharedFaceInClient(
    userId: string,
    clientId: string,
    exclude: BondExclude = {},
  ): Promise<SharedFaceSnapshot | null> {
    return peopleQueries.findSharedFaceByUserIdAndClient(
      this.database.db,
      userId,
      clientId,
      exclude,
    );
  }

  /** Aplica face compartilhada da mesma escola em um vínculo recém-criado (sem sync no leitor). */
  async applySharedFaceFromSameClient(
    userId: string,
    clientId: string,
    target: FaceBondRef,
  ): Promise<boolean> {
    const shared = await this.findSharedFaceInClient(userId, clientId, {
      responsibleId: target.type === 'responsible' ? target.id : undefined,
      memberId: target.type === 'member' ? target.id : undefined,
    });
    if (!shared) return false;

    await this.writeFaceToBond(clientId, target, shared);
    return true;
  }

  /**
   * Copia foto de outra escola: novo faceId + sync nos leitores da escola alvo.
   * Retorna true se copiou com sucesso.
   */
  async copyFaceFromOtherClientToBond(
    userId: string,
    clientId: string,
    target: FaceBondRef,
    logContext: string,
  ): Promise<boolean> {
    const source = await peopleQueries.findFaceWithPhotoByUserIdExcludingClient(
      this.database.db,
      userId,
      clientId,
    );
    if (!source?.photoKey) return false;

    let buffer: Buffer;
    try {
      const got = await this.r2.getObjectBytes(source.photoKey);
      buffer = got.buffer;
    } catch (e: unknown) {
      this.log.warn(
        `${logContext}: falha ao ler foto de outra escola (${source.photoKey}): ${e instanceof Error ? e.message : String(e)}`,
      );
      return false;
    }

    if (!(await isPortraitImageUsable(buffer))) return false;

    const faceId = await registrationsQueries.bumpClientFaceCounter(
      this.database.db,
      clientId,
    );

    const photoKey =
      target.type === 'responsible'
        ? `responsibles/${clientId}/${target.id}/face.jpg`
        : `members/${clientId}/${target.id}/face.jpg`;

    await this.r2.putObject(photoKey, buffer, 'image/jpeg');

    await this.writeFaceToBond(clientId, target, {
      faceId,
      photoKey,
      deviceSyncStatus: 'pending_sync',
      deviceSyncedAt: null,
      deviceSyncError: null,
    });

    const timeSectionIds =
      target.type === 'responsible'
        ? await this.accessTimeZone.resolveResponsibleTimeSections(
            clientId,
            target.id,
          )
        : await this.accessTimeZone.resolveMemberTimeSections(
            clientId,
            target.id,
          );

    const sync = await this.faceSync.syncPersonOnReaders({
      clientId,
      faceId,
      name: target.name,
      imageBuffer: buffer,
      timeSectionIds,
      logContext: `${logContext}-face-copy`,
    });

    await this.writeFaceToBond(clientId, target, {
      faceId,
      photoKey,
      deviceSyncStatus: sync.deviceSyncStatus,
      deviceSyncedAt: sync.deviceSyncStatus === 'synced' ? new Date() : null,
      deviceSyncError: sync.deviceSyncError,
    });

    await this.propagateFaceToSiblings(userId, clientId, {
      faceId,
      photoKey,
      deviceSyncStatus: sync.deviceSyncStatus,
      deviceSyncedAt: sync.deviceSyncStatus === 'synced' ? new Date() : null,
      deviceSyncError: sync.deviceSyncError,
    }, {
      responsibleId: target.type === 'responsible' ? target.id : undefined,
      memberId: target.type === 'member' ? target.id : undefined,
    });

    return true;
  }

  /**
   * Após upload/sync em um vínculo, replica face para irmãos na mesma escola
   * (sem re-sincronizar no leitor — mesmo faceId).
   */
  async propagateFaceToSiblings(
    userId: string,
    clientId: string,
    face: SharedFaceSnapshot,
    exclude: BondExclude = {},
  ): Promise<void> {
    const siblings = await peopleQueries.listSiblingBondsByUserIdAndClient(
      this.database.db,
      userId,
      clientId,
      exclude,
    );

    await Promise.all([
      ...siblings.responsibleIds.map((id) =>
        responsiblesQueries.updateResponsibleFace(
          this.database.db,
          id,
          clientId,
          face,
        ),
      ),
      ...siblings.memberIds.map((id) =>
        membersQueries.updateMemberFace(this.database.db, id, clientId, face),
      ),
    ]);
  }

  /**
   * Alinha o vínculo com a face compartilhada do irmão na mesma escola (lazy backfill).
   * Retorna a face efetiva após reconciliação, ou null se não houver irmão com foto.
   */
  async reconcileSharedFaceOnBond(
    userId: string,
    clientId: string,
    target: FaceBondRef,
    current: { faceId: number | null; photoKey: string | null },
  ): Promise<SharedFaceSnapshot | null> {
    const shared = await this.findSharedFaceInClient(userId, clientId, {
      responsibleId: target.type === 'responsible' ? target.id : undefined,
      memberId: target.type === 'member' ? target.id : undefined,
    });
    if (!shared) return null;

    const aligned =
      current.faceId === shared.faceId &&
      current.photoKey === shared.photoKey;

    if (!aligned) {
      await this.writeFaceToBond(clientId, target, shared);
    }
    return shared;
  }

  /** Resolve faceId compartilhado antes de um novo enrollment (evita segundo UserID no leitor). */
  async resolveSharedFaceIdForEnrollment(
    userId: string | null | undefined,
    clientId: string,
    currentFaceId: number | null,
    exclude: BondExclude = {},
  ): Promise<number | null> {
    if (currentFaceId != null) return currentFaceId;
    if (!userId) return null;

    const shared = await this.findSharedFaceInClient(userId, clientId, exclude);
    return shared?.faceId ?? null;
  }

  async shouldRemoveFaceFromReader(
    faceId: number,
    clientId: string,
    exclude: BondExclude,
  ): Promise<boolean> {
    const others = await peopleQueries.countOtherBondsSharingFaceId(
      this.database.db,
      faceId,
      clientId,
      exclude,
    );
    return others === 0;
  }

  private async writeFaceToBond(
    clientId: string,
    target: FaceBondRef,
    face: SharedFaceSnapshot,
  ): Promise<void> {
    if (target.type === 'responsible') {
      await responsiblesQueries.updateResponsibleFace(
        this.database.db,
        target.id,
        clientId,
        face,
      );
      return;
    }
    await membersQueries.updateMemberFace(
      this.database.db,
      target.id,
      clientId,
      face,
    );
  }
}
