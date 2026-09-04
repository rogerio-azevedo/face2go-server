import { and, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';

import type { AccessPersonType } from '../../common/access-person.types';
import type { AppDb } from '../database.types';
import {
  clientInvites,
  clientMembers,
  registrations,
  responsibles,
  students,
  temporaryPickupAuthorizations,
} from '../schema';

export type DeviceUserSystemPerson = {
  faceId: number;
  name: string;
  personType: AccessPersonType;
};

function addIfMissing(
  map: Map<number, DeviceUserSystemPerson>,
  faceId: number | null,
  name: string | null | undefined,
  personType: AccessPersonType,
) {
  if (faceId == null || map.has(faceId)) return;
  map.set(faceId, {
    faceId,
    name: name?.trim() ?? '',
    personType,
  });
}

/** Resolve faceIds do cliente na mesma ordem de `resolveAccessPersonByFaceId`. */
export async function listPersonsByFaceIds(
  db: AppDb,
  clientId: string,
  faceIds: number[],
): Promise<Map<number, DeviceUserSystemPerson>> {
  const result = new Map<number, DeviceUserSystemPerson>();
  const unique = [
    ...new Set(faceIds.filter((id) => Number.isInteger(id) && id > 0)),
  ];
  if (unique.length === 0) return result;

  const [responsibleRows, studentRows, memberRows, registrationRows] =
    await Promise.all([
      db
        .select({
          faceId: responsibles.faceId,
          name: responsibles.name,
        })
        .from(responsibles)
        .where(
          and(
            eq(responsibles.clientId, clientId),
            inArray(responsibles.faceId, unique),
            eq(responsibles.isActive, true),
          ),
        ),
      db
        .select({
          faceId: students.faceId,
          name: students.name,
        })
        .from(students)
        .where(
          and(
            eq(students.clientId, clientId),
            inArray(students.faceId, unique),
            eq(students.isActive, true),
          ),
        ),
      db
        .select({
          faceId: clientMembers.faceId,
          name: clientMembers.name,
        })
        .from(clientMembers)
        .where(
          and(
            eq(clientMembers.clientId, clientId),
            inArray(clientMembers.faceId, unique),
            eq(clientMembers.isActive, true),
          ),
        ),
      db
        .select({
          faceId: registrations.faceId,
          name: registrations.name,
        })
        .from(registrations)
        .where(
          and(
            eq(registrations.clientId, clientId),
            inArray(registrations.faceId, unique),
            eq(registrations.status, 'approved'),
          ),
        ),
    ]);

  for (const row of responsibleRows) {
    addIfMissing(result, row.faceId, row.name, 'responsible');
  }
  for (const row of studentRows) {
    addIfMissing(result, row.faceId, row.name, 'student');
  }
  for (const row of memberRows) {
    addIfMissing(result, row.faceId, row.name, 'member');
  }
  for (const row of registrationRows) {
    addIfMissing(result, row.faceId, row.name, 'guest');
  }

  const missing = unique.filter((id) => !result.has(id));
  if (missing.length === 0) return result;

  const now = new Date();
  const [pickupRows, inviteRows] = await Promise.all([
    db
      .select({
        faceId: temporaryPickupAuthorizations.guestFaceId,
        name: temporaryPickupAuthorizations.guestName,
      })
      .from(temporaryPickupAuthorizations)
      .where(
        and(
          eq(temporaryPickupAuthorizations.clientId, clientId),
          inArray(temporaryPickupAuthorizations.guestFaceId, missing),
          eq(temporaryPickupAuthorizations.status, 'active'),
          eq(temporaryPickupAuthorizations.guestApprovalStatus, 'approved'),
          lte(temporaryPickupAuthorizations.validFrom, now),
          gte(temporaryPickupAuthorizations.validUntil, now),
        ),
      ),
    db
      .select({
        faceId: clientInvites.guestFaceId,
        name: clientInvites.guestName,
      })
      .from(clientInvites)
      .where(
        and(
          eq(clientInvites.clientId, clientId),
          inArray(clientInvites.guestFaceId, missing),
          eq(clientInvites.status, 'active'),
          eq(clientInvites.guestApprovalStatus, 'approved'),
          lte(clientInvites.validFrom, now),
          gte(clientInvites.validUntil, now),
        ),
      ),
  ]);

  for (const row of pickupRows) {
    addIfMissing(result, row.faceId, row.name, 'guest');
  }
  for (const row of inviteRows) {
    addIfMissing(result, row.faceId, row.name, 'guest');
  }

  return result;
}

export async function listClientFaceIds(
  db: AppDb,
  clientId: string,
): Promise<Set<number>> {
  const now = new Date();
  const [
    responsibleRows,
    studentRows,
    memberRows,
    registrationRows,
    pickupRows,
    inviteRows,
  ] = await Promise.all([
    db
      .select({ faceId: responsibles.faceId })
      .from(responsibles)
      .where(
        and(
          eq(responsibles.clientId, clientId),
          isNotNull(responsibles.faceId),
          eq(responsibles.isActive, true),
        ),
      ),
    db
      .select({ faceId: students.faceId })
      .from(students)
      .where(
        and(
          eq(students.clientId, clientId),
          isNotNull(students.faceId),
          eq(students.isActive, true),
        ),
      ),
    db
      .select({ faceId: clientMembers.faceId })
      .from(clientMembers)
      .where(
        and(
          eq(clientMembers.clientId, clientId),
          isNotNull(clientMembers.faceId),
          eq(clientMembers.isActive, true),
        ),
      ),
    db
      .select({ faceId: registrations.faceId })
      .from(registrations)
      .where(
        and(
          eq(registrations.clientId, clientId),
          isNotNull(registrations.faceId),
          eq(registrations.status, 'approved'),
        ),
      ),
    db
      .select({ faceId: temporaryPickupAuthorizations.guestFaceId })
      .from(temporaryPickupAuthorizations)
      .where(
        and(
          eq(temporaryPickupAuthorizations.clientId, clientId),
          isNotNull(temporaryPickupAuthorizations.guestFaceId),
          eq(temporaryPickupAuthorizations.status, 'active'),
          eq(temporaryPickupAuthorizations.guestApprovalStatus, 'approved'),
          lte(temporaryPickupAuthorizations.validFrom, now),
          gte(temporaryPickupAuthorizations.validUntil, now),
        ),
      ),
    db
      .select({ faceId: clientInvites.guestFaceId })
      .from(clientInvites)
      .where(
        and(
          eq(clientInvites.clientId, clientId),
          isNotNull(clientInvites.guestFaceId),
          eq(clientInvites.status, 'active'),
          eq(clientInvites.guestApprovalStatus, 'approved'),
          lte(clientInvites.validFrom, now),
          gte(clientInvites.validUntil, now),
        ),
      ),
  ]);

  const ids = new Set<number>();
  for (const row of [
    ...responsibleRows,
    ...studentRows,
    ...memberRows,
    ...registrationRows,
    ...pickupRows,
    ...inviteRows,
  ]) {
    if (row.faceId != null) ids.add(row.faceId);
  }
  return ids;
}
