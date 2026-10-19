import { and, desc, eq, inArray, or, type SQL } from 'drizzle-orm';

import type { AppDb } from '../database/database.types';
import {
  clientInvites,
  clientMembers,
  clients,
  registrations,
  responsibles,
  temporaryPickupAuthorizations,
} from '../database/schema';

export type AccessPhoneLookupRow = {
  id: string;
  clientId: string;
  userId: number;
  personId: string | null;
  personType: string | null;
};

function faceKey(clientId: string, faceId: number): string {
  return `${clientId}:${faceId}`;
}

function rememberPhone(
  map: Map<string, string>,
  key: string,
  phone: string | null,
): void {
  const trimmed = phone?.trim();
  if (!trimmed || map.has(key)) return;
  map.set(key, trimmed);
}

function idOrFace(
  ids: string[],
  idColumn: Parameters<typeof inArray>[0],
  faceIds: number[],
  faceColumn: Parameters<typeof inArray>[0],
): SQL | undefined {
  const parts: SQL[] = [];
  if (ids.length > 0) parts.push(inArray(idColumn, ids));
  if (faceIds.length > 0) parts.push(inArray(faceColumn, faceIds));
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return or(...parts);
}

function idsOfType(rows: AccessPhoneLookupRow[], personType: string): string[] {
  return [
    ...new Set(
      rows
        .filter((row) => row.personType === personType && row.personId)
        .map((row) => row.personId as string),
    ),
  ];
}

/**
 * Telefone atual da pessoa de cada acesso da página.
 * Prioridade: cadastro (registrations) pelo par cliente+face, depois membro,
 * responsável e, por último, visitante de convite ou retirada.
 */
export async function findAccessPersonPhones(
  db: AppDb,
  companyId: string,
  rows: AccessPhoneLookupRow[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (rows.length === 0) return result;

  const clientIds = [
    ...new Set(rows.map((row) => row.clientId).filter(Boolean)),
  ];
  const faceIds = [
    ...new Set(
      rows
        .map((row) => row.userId)
        .filter((faceId) => Number.isFinite(faceId) && faceId > 0),
    ),
  ];
  const memberIds = idsOfType(rows, 'member');
  const responsibleIds = idsOfType(rows, 'responsible');
  const guestIds = idsOfType(rows, 'guest');

  const memberMatch = idOrFace(
    memberIds,
    clientMembers.id,
    faceIds,
    clientMembers.faceId,
  );
  const responsibleMatch = idOrFace(
    responsibleIds,
    responsibles.id,
    faceIds,
    responsibles.faceId,
  );

  const [
    registrationRows,
    memberRows,
    responsibleRows,
    pickupRows,
    inviteRows,
  ] = await Promise.all([
    clientIds.length > 0 && faceIds.length > 0
      ? db
          .select({
            clientId: registrations.clientId,
            faceId: registrations.faceId,
            phone: registrations.phone,
          })
          .from(registrations)
          .innerJoin(clients, eq(clients.id, registrations.clientId))
          .where(
            and(
              eq(clients.companyId, companyId),
              inArray(registrations.clientId, clientIds),
              inArray(registrations.faceId, faceIds),
            ),
          )
          .orderBy(desc(registrations.isActive), desc(registrations.updatedAt))
      : Promise.resolve([]),
    clientIds.length > 0 && memberMatch
      ? db
          .select({
            id: clientMembers.id,
            clientId: clientMembers.clientId,
            faceId: clientMembers.faceId,
            phone: clientMembers.phone,
          })
          .from(clientMembers)
          .innerJoin(clients, eq(clients.id, clientMembers.clientId))
          .where(
            and(
              eq(clients.companyId, companyId),
              inArray(clientMembers.clientId, clientIds),
              memberMatch,
            ),
          )
          .orderBy(desc(clientMembers.isActive), desc(clientMembers.updatedAt))
      : Promise.resolve([]),
    clientIds.length > 0 && responsibleMatch
      ? db
          .select({
            id: responsibles.id,
            clientId: responsibles.clientId,
            faceId: responsibles.faceId,
            phone: responsibles.phone,
          })
          .from(responsibles)
          .innerJoin(clients, eq(clients.id, responsibles.clientId))
          .where(
            and(
              eq(clients.companyId, companyId),
              inArray(responsibles.clientId, clientIds),
              responsibleMatch,
            ),
          )
          .orderBy(desc(responsibles.isActive), desc(responsibles.updatedAt))
      : Promise.resolve([]),
    clientIds.length > 0 && guestIds.length > 0
      ? db
          .select({
            id: temporaryPickupAuthorizations.id,
            phone: temporaryPickupAuthorizations.guestPhone,
          })
          .from(temporaryPickupAuthorizations)
          .innerJoin(
            clients,
            eq(clients.id, temporaryPickupAuthorizations.clientId),
          )
          .where(
            and(
              eq(clients.companyId, companyId),
              inArray(temporaryPickupAuthorizations.clientId, clientIds),
              inArray(temporaryPickupAuthorizations.id, guestIds),
            ),
          )
      : Promise.resolve([]),
    clientIds.length > 0 && guestIds.length > 0
      ? db
          .select({
            id: clientInvites.id,
            phone: clientInvites.guestPhone,
          })
          .from(clientInvites)
          .innerJoin(clients, eq(clients.id, clientInvites.clientId))
          .where(
            and(
              eq(clients.companyId, companyId),
              inArray(clientInvites.clientId, clientIds),
              inArray(clientInvites.id, guestIds),
            ),
          )
      : Promise.resolve([]),
  ]);

  const registrationByFace = new Map<string, string>();
  for (const row of registrationRows) {
    if (row.faceId == null) continue;
    rememberPhone(
      registrationByFace,
      faceKey(row.clientId, row.faceId),
      row.phone,
    );
  }

  const memberById = new Map<string, string>();
  const memberByFace = new Map<string, string>();
  for (const row of memberRows) {
    rememberPhone(memberById, row.id, row.phone);
    if (row.faceId != null) {
      rememberPhone(memberByFace, faceKey(row.clientId, row.faceId), row.phone);
    }
  }

  const responsibleById = new Map<string, string>();
  const responsibleByFace = new Map<string, string>();
  for (const row of responsibleRows) {
    rememberPhone(responsibleById, row.id, row.phone);
    if (row.faceId != null) {
      rememberPhone(
        responsibleByFace,
        faceKey(row.clientId, row.faceId),
        row.phone,
      );
    }
  }

  const guestById = new Map<string, string>();
  for (const row of pickupRows) rememberPhone(guestById, row.id, row.phone);
  for (const row of inviteRows) rememberPhone(guestById, row.id, row.phone);

  for (const row of rows) {
    const face =
      Number.isFinite(row.userId) && row.userId > 0
        ? faceKey(row.clientId, row.userId)
        : null;
    const phone =
      (face ? registrationByFace.get(face) : undefined) ??
      (row.personType === 'member' && row.personId
        ? memberById.get(row.personId)
        : undefined) ??
      (face ? memberByFace.get(face) : undefined) ??
      (row.personType === 'responsible' && row.personId
        ? responsibleById.get(row.personId)
        : undefined) ??
      (face ? responsibleByFace.get(face) : undefined) ??
      (row.personType === 'guest' && row.personId
        ? guestById.get(row.personId)
        : undefined) ??
      null;
    result.set(row.id, phone);
  }

  return result;
}
