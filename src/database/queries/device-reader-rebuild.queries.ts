import { and, eq, gte, isNotNull } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { clientInvites, clientMembers, registrations } from '../schema';

export async function listMembersWithFaceByClient(db: AppDb, clientId: string) {
  return db
    .select({
      id: clientMembers.id,
      name: clientMembers.name,
      faceId: clientMembers.faceId,
      photoKey: clientMembers.photoKey,
    })
    .from(clientMembers)
    .where(
      and(
        eq(clientMembers.clientId, clientId),
        eq(clientMembers.isActive, true),
        isNotNull(clientMembers.photoKey),
        isNotNull(clientMembers.faceId),
      ),
    );
}

export async function listApprovedRegistrationsWithFaceByClient(
  db: AppDb,
  clientId: string,
) {
  return db
    .select({
      id: registrations.id,
      name: registrations.name,
      faceId: registrations.faceId,
      photoKey: registrations.faceImageKey,
    })
    .from(registrations)
    .where(
      and(
        eq(registrations.clientId, clientId),
        eq(registrations.status, 'approved'),
        isNotNull(registrations.faceImageKey),
        isNotNull(registrations.faceId),
      ),
    );
}

export async function listActiveInvitesWithFaceByClient(
  db: AppDb,
  clientId: string,
) {
  return db
    .select({
      id: clientInvites.id,
      name: clientInvites.guestName,
      faceId: clientInvites.guestFaceId,
      photoKey: clientInvites.guestFaceImageKey,
      validFrom: clientInvites.validFrom,
      validUntil: clientInvites.validUntil,
    })
    .from(clientInvites)
    .where(
      and(
        eq(clientInvites.clientId, clientId),
        eq(clientInvites.status, 'active'),
        isNotNull(clientInvites.guestFaceId),
        isNotNull(clientInvites.guestFaceImageKey),
        gte(clientInvites.validUntil, new Date()),
      ),
    );
}
