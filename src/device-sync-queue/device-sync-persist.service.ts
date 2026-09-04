import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { DatabaseService } from '../database/database.service';
import * as inviteQueries from '../database/queries/client-invites.queries';
import * as membersQueries from '../database/queries/members.queries';
import * as pickupQueries from '../database/queries/pickup-authorizations.queries';
import * as registrationsQueries from '../database/queries/registrations.queries';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as studentsQueries from '../database/queries/students.queries';
import type { FaceSyncOutcome } from '../face-sync/face-sync.events';
import {
  INVITE_GUEST_FACE_SYNCED,
  type InviteGuestFaceSyncedPayload,
  PICKUP_GUEST_FACE_SYNCED,
  type PickupGuestFaceSyncedPayload,
} from '../notifications/notifications.events';
import type { FacePersonJobPayload } from './device-sync-queue.types';

@Injectable()
export class DeviceSyncPersistService {
  constructor(
    private readonly database: DatabaseService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async persistFacePerson(
    clientId: string,
    targetId: string,
    payload: FacePersonJobPayload,
    sync: FaceSyncOutcome,
  ): Promise<void> {
    const patch = {
      deviceSyncStatus: sync.deviceSyncStatus,
      deviceSyncedAt: sync.deviceSyncStatus === 'synced' ? new Date() : null,
      deviceSyncError: sync.deviceSyncError,
    };

    switch (payload.entityKind) {
      case 'registration':
        await registrationsQueries.updateRegistrationDeviceSync(
          this.database.db,
          targetId,
          clientId,
          patch,
        );
        return;
      case 'student':
        await studentsQueries.updateStudentFace(
          this.database.db,
          targetId,
          clientId,
          patch,
        );
        return;
      case 'responsible':
        await responsiblesQueries.updateResponsibleFace(
          this.database.db,
          targetId,
          clientId,
          patch,
        );
        return;
      case 'member':
        await membersQueries.updateMemberFace(
          this.database.db,
          targetId,
          clientId,
          patch,
        );
        return;
      case 'invite_guest':
        await inviteQueries.inviteUpdateGuestApproval(
          this.database.db,
          targetId,
          clientId,
          {
            guestFaceSyncStatus: sync.deviceSyncStatus,
            guestFaceSyncedAt: patch.deviceSyncedAt,
            guestFaceSyncError: sync.deviceSyncError,
          },
        );
        if (payload.requestedByMemberId) {
          this.eventEmitter.emit(INVITE_GUEST_FACE_SYNCED, {
            inviteId: targetId,
            clientId,
            requestedByMemberId: payload.requestedByMemberId,
            guestName: payload.name,
            syncStatus: sync.deviceSyncStatus,
          } satisfies InviteGuestFaceSyncedPayload);
        }
        return;
      case 'pickup_guest':
        await pickupQueries.pickupAuthUpdateGuestApproval(
          this.database.db,
          targetId,
          clientId,
          {
            guestFaceSyncStatus: sync.deviceSyncStatus,
            guestFaceSyncedAt: patch.deviceSyncedAt,
            guestFaceSyncError: sync.deviceSyncError,
          },
        );
        if (payload.requestedByMemberId) {
          this.eventEmitter.emit(PICKUP_GUEST_FACE_SYNCED, {
            authorizationId: targetId,
            clientId,
            requestedByResponsibleId: payload.requestedByMemberId,
            guestName: payload.name,
            syncStatus: sync.deviceSyncStatus,
          } satisfies PickupGuestFaceSyncedPayload);
        }
        return;
      default:
        return;
    }
  }
}
