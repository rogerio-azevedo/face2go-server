import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import { toIsoDateString } from '../../common/utils/birth-date';
import type { AppDb } from '../database.types';
import {
  clientInvites,
  clientMembers,
  registrations,
  responsibles,
  students,
  temporaryPickupAuthorizations,
} from '../schema';

function rememberBirthDate(
  map: Map<number, string | null>,
  faceId: number | null,
  birthDate: unknown,
) {
  if (faceId == null) return;
  if (!map.has(faceId) || map.get(faceId) == null) {
    map.set(faceId, toIsoDateString(birthDate));
  }
}

function rememberFaceId(set: Set<number>, faceId: number | null) {
  if (faceId != null) set.add(faceId);
}

/** Data de nascimento da pessoa dona do faceId neste cliente, se houver. */
export async function getBirthDateByFaceId(
  db: AppDb,
  clientId: string,
  faceId: number,
): Promise<string | null> {
  const map = await listBirthDatesByFaceIds(db, clientId, [faceId]);
  return map.get(faceId) ?? null;
}

export async function listBirthDatesByFaceIds(
  db: AppDb,
  clientId: string,
  faceIds: number[],
): Promise<Map<number, string | null>> {
  const map = new Map<number, string | null>();
  if (faceIds.length === 0) return map;
  for (const id of faceIds) map.set(id, null);

  const [memberRows, studentRows, registrationRows] = await Promise.all([
    db
      .select({
        faceId: clientMembers.faceId,
        birthDate: clientMembers.birthDate,
      })
      .from(clientMembers)
      .where(
        and(
          eq(clientMembers.clientId, clientId),
          inArray(clientMembers.faceId, faceIds),
        ),
      ),
    db
      .select({
        faceId: students.faceId,
        birthDate: students.birthDate,
      })
      .from(students)
      .where(
        and(eq(students.clientId, clientId), inArray(students.faceId, faceIds)),
      ),
    db
      .select({
        faceId: registrations.faceId,
        birthDate: registrations.birthDate,
      })
      .from(registrations)
      .where(
        and(
          eq(registrations.clientId, clientId),
          inArray(registrations.faceId, faceIds),
        ),
      ),
  ]);

  for (const row of memberRows) {
    rememberBirthDate(map, row.faceId, row.birthDate);
  }
  for (const row of studentRows) {
    rememberBirthDate(map, row.faceId, row.birthDate);
  }
  for (const row of registrationRows) {
    rememberBirthDate(map, row.faceId, row.birthDate);
  }
  return map;
}

/** Face IDs conhecidos do cliente (membros, alunos, cadastros, responsáveis, convites, retiradas). */
export async function listFaceIdsByClient(
  db: AppDb,
  clientId: string,
): Promise<number[]> {
  const [
    memberRows,
    studentRows,
    registrationRows,
    responsibleRows,
    inviteRows,
    pickupRows,
  ] = await Promise.all([
    db
      .select({ faceId: clientMembers.faceId })
      .from(clientMembers)
      .where(
        and(
          eq(clientMembers.clientId, clientId),
          isNotNull(clientMembers.faceId),
        ),
      ),
    db
      .select({ faceId: students.faceId })
      .from(students)
      .where(and(eq(students.clientId, clientId), isNotNull(students.faceId))),
    db
      .select({ faceId: registrations.faceId })
      .from(registrations)
      .where(
        and(
          eq(registrations.clientId, clientId),
          isNotNull(registrations.faceId),
        ),
      ),
    db
      .select({ faceId: responsibles.faceId })
      .from(responsibles)
      .where(
        and(
          eq(responsibles.clientId, clientId),
          isNotNull(responsibles.faceId),
        ),
      ),
    db
      .select({ faceId: clientInvites.guestFaceId })
      .from(clientInvites)
      .where(
        and(
          eq(clientInvites.clientId, clientId),
          isNotNull(clientInvites.guestFaceId),
        ),
      ),
    db
      .select({ faceId: temporaryPickupAuthorizations.guestFaceId })
      .from(temporaryPickupAuthorizations)
      .where(
        and(
          eq(temporaryPickupAuthorizations.clientId, clientId),
          isNotNull(temporaryPickupAuthorizations.guestFaceId),
        ),
      ),
  ]);

  const ids = new Set<number>();
  for (const row of memberRows) rememberFaceId(ids, row.faceId);
  for (const row of studentRows) rememberFaceId(ids, row.faceId);
  for (const row of registrationRows) rememberFaceId(ids, row.faceId);
  for (const row of responsibleRows) rememberFaceId(ids, row.faceId);
  for (const row of inviteRows) rememberFaceId(ids, row.faceId);
  for (const row of pickupRows) rememberFaceId(ids, row.faceId);
  return [...ids];
}
