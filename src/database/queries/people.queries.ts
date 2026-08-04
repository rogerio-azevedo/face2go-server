import { and, eq, isNotNull, ne } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { clientMembers, responsibles } from '../schema';

export type SharedFaceSnapshot = {
  faceId: number;
  photoKey: string;
  deviceSyncStatus: 'pending_sync' | 'synced' | 'sync_failed' | null;
  deviceSyncedAt: Date | null;
  deviceSyncError: string | null;
};

export type SiblingBonds = {
  responsibleIds: string[];
  memberIds: string[];
};

export type BondExclude = {
  responsibleId?: string;
  memberId?: string;
};

export type FaceBondRef =
  | { type: 'responsible'; id: string; name: string }
  | { type: 'member'; id: string; name: string };

function faceFieldsFromRow(row: {
  faceId: number | null;
  photoKey: string | null;
  deviceSyncStatus: SharedFaceSnapshot['deviceSyncStatus'];
  deviceSyncedAt: Date | null;
  deviceSyncError: string | null;
}): SharedFaceSnapshot | null {
  if (row.faceId == null || !row.photoKey) return null;
  return {
    faceId: row.faceId,
    photoKey: row.photoKey,
    deviceSyncStatus: row.deviceSyncStatus,
    deviceSyncedAt: row.deviceSyncedAt,
    deviceSyncError: row.deviceSyncError,
  };
}

/** Vínculos ativos (responsável + membro) do mesmo userId na mesma escola. */
export async function listSiblingBondsByUserIdAndClient(
  db: AppDb,
  userId: string,
  clientId: string,
  exclude: BondExclude = {},
): Promise<SiblingBonds> {
  const [responsibleRows, memberRows] = await Promise.all([
    db
      .select({ id: responsibles.id })
      .from(responsibles)
      .where(
        and(
          eq(responsibles.userId, userId),
          eq(responsibles.clientId, clientId),
          eq(responsibles.isActive, true),
          exclude.responsibleId
            ? ne(responsibles.id, exclude.responsibleId)
            : undefined,
        ),
      ),
    db
      .select({ id: clientMembers.id })
      .from(clientMembers)
      .where(
        and(
          eq(clientMembers.userId, userId),
          eq(clientMembers.clientId, clientId),
          eq(clientMembers.isActive, true),
          exclude.memberId ? ne(clientMembers.id, exclude.memberId) : undefined,
        ),
      ),
  ]);

  return {
    responsibleIds: responsibleRows.map((r) => r.id),
    memberIds: memberRows.map((r) => r.id),
  };
}

/** Face ativa compartilhada entre vínculos irmãos na mesma escola. */
export async function findSharedFaceByUserIdAndClient(
  db: AppDb,
  userId: string,
  clientId: string,
  exclude: BondExclude = {},
): Promise<SharedFaceSnapshot | null> {
  const [responsibleRow, memberRow] = await Promise.all([
    db
      .select({
        faceId: responsibles.faceId,
        photoKey: responsibles.photoKey,
        deviceSyncStatus: responsibles.deviceSyncStatus,
        deviceSyncedAt: responsibles.deviceSyncedAt,
        deviceSyncError: responsibles.deviceSyncError,
      })
      .from(responsibles)
      .where(
        and(
          eq(responsibles.userId, userId),
          eq(responsibles.clientId, clientId),
          eq(responsibles.isActive, true),
          isNotNull(responsibles.photoKey),
          isNotNull(responsibles.faceId),
          exclude.responsibleId
            ? ne(responsibles.id, exclude.responsibleId)
            : undefined,
        ),
      )
      .limit(1),
    db
      .select({
        faceId: clientMembers.faceId,
        photoKey: clientMembers.photoKey,
        deviceSyncStatus: clientMembers.deviceSyncStatus,
        deviceSyncedAt: clientMembers.deviceSyncedAt,
        deviceSyncError: clientMembers.deviceSyncError,
      })
      .from(clientMembers)
      .where(
        and(
          eq(clientMembers.userId, userId),
          eq(clientMembers.clientId, clientId),
          eq(clientMembers.isActive, true),
          isNotNull(clientMembers.photoKey),
          isNotNull(clientMembers.faceId),
          exclude.memberId ? ne(clientMembers.id, exclude.memberId) : undefined,
        ),
      )
      .limit(1),
  ]);

  return (
    faceFieldsFromRow(responsibleRow[0] ?? {}) ??
    faceFieldsFromRow(memberRow[0] ?? {}) ??
    null
  );
}

/** Face com foto em outra escola (responsável ou membro). */
export async function findFaceWithPhotoByUserIdExcludingClient(
  db: AppDb,
  userId: string,
  excludeClientId: string,
): Promise<(SharedFaceSnapshot & { clientId: string }) | null> {
  const [responsibleRow, memberRow] = await Promise.all([
    db
      .select({
        clientId: responsibles.clientId,
        faceId: responsibles.faceId,
        photoKey: responsibles.photoKey,
        deviceSyncStatus: responsibles.deviceSyncStatus,
        deviceSyncedAt: responsibles.deviceSyncedAt,
        deviceSyncError: responsibles.deviceSyncError,
      })
      .from(responsibles)
      .where(
        and(
          eq(responsibles.userId, userId),
          ne(responsibles.clientId, excludeClientId),
          eq(responsibles.isActive, true),
          isNotNull(responsibles.photoKey),
        ),
      )
      .limit(1),
    db
      .select({
        clientId: clientMembers.clientId,
        faceId: clientMembers.faceId,
        photoKey: clientMembers.photoKey,
        deviceSyncStatus: clientMembers.deviceSyncStatus,
        deviceSyncedAt: clientMembers.deviceSyncedAt,
        deviceSyncError: clientMembers.deviceSyncError,
      })
      .from(clientMembers)
      .where(
        and(
          eq(clientMembers.userId, userId),
          ne(clientMembers.clientId, excludeClientId),
          eq(clientMembers.isActive, true),
          isNotNull(clientMembers.photoKey),
        ),
      )
      .limit(1),
  ]);

  const pick = responsibleRow[0] ?? memberRow[0];
  if (!pick) return null;

  const face = faceFieldsFromRow(pick);
  if (!face) return null;

  return { ...face, clientId: pick.clientId };
}

/** Outros vínculos ativos que ainda usam o mesmo faceId na escola. */
export async function countOtherBondsSharingFaceId(
  db: AppDb,
  faceId: number,
  clientId: string,
  exclude: BondExclude,
): Promise<number> {
  const conditions = [
    eq(responsibles.clientId, clientId),
    eq(responsibles.faceId, faceId),
    eq(responsibles.isActive, true),
  ];
  if (exclude.responsibleId) {
    conditions.push(ne(responsibles.id, exclude.responsibleId));
  }

  const memberConditions = [
    eq(clientMembers.clientId, clientId),
    eq(clientMembers.faceId, faceId),
    eq(clientMembers.isActive, true),
  ];
  if (exclude.memberId) {
    memberConditions.push(ne(clientMembers.id, exclude.memberId));
  }

  const [respCount, memberCount] = await Promise.all([
    db
      .select({ id: responsibles.id })
      .from(responsibles)
      .where(and(...conditions)),
    db
      .select({ id: clientMembers.id })
      .from(clientMembers)
      .where(and(...memberConditions)),
  ]);

  return respCount.length + memberCount.length;
}

export async function listResponsiblesByFaceIdAndClientId(
  db: AppDb,
  faceId: number,
  clientId: string,
) {
  return db
    .select({
      id: responsibles.id,
      name: responsibles.name,
      photoKey: responsibles.photoKey,
      userId: responsibles.userId,
    })
    .from(responsibles)
    .where(
      and(
        eq(responsibles.clientId, clientId),
        eq(responsibles.faceId, faceId),
        eq(responsibles.isActive, true),
      ),
    );
}

export async function listMembersByFaceIdAndClientId(
  db: AppDb,
  faceId: number,
  clientId: string,
) {
  return db
    .select({
      id: clientMembers.id,
      name: clientMembers.name,
      photoKey: clientMembers.photoKey,
      userId: clientMembers.userId,
    })
    .from(clientMembers)
    .where(
      and(
        eq(clientMembers.clientId, clientId),
        eq(clientMembers.faceId, faceId),
        eq(clientMembers.isActive, true),
      ),
    );
}

/** IDs de condutores (responsibleId/memberId) de todos os vínculos da pessoa na escola. */
export async function listVehicleOwnerIdsByUserIdAndClient(
  db: AppDb,
  userId: string,
  clientId: string,
): Promise<{ responsibleIds: string[]; memberIds: string[] }> {
  const [responsibleRows, memberRows] = await Promise.all([
    db
      .select({ id: responsibles.id })
      .from(responsibles)
      .where(
        and(
          eq(responsibles.userId, userId),
          eq(responsibles.clientId, clientId),
          eq(responsibles.isActive, true),
        ),
      ),
    db
      .select({ id: clientMembers.id })
      .from(clientMembers)
      .where(
        and(
          eq(clientMembers.userId, userId),
          eq(clientMembers.clientId, clientId),
          eq(clientMembers.isActive, true),
        ),
      ),
  ]);

  return {
    responsibleIds: responsibleRows.map((r) => r.id),
    memberIds: memberRows.map((r) => r.id),
  };
}

/** Resolve userId a partir de um condutor de veículo na escola. */
export async function findUserIdByVehicleOwner(
  db: AppDb,
  clientId: string,
  owner: { responsibleId?: string | null; memberId?: string | null },
): Promise<string | null> {
  if (owner.responsibleId) {
    const [row] = await db
      .select({ userId: responsibles.userId })
      .from(responsibles)
      .where(
        and(
          eq(responsibles.id, owner.responsibleId),
          eq(responsibles.clientId, clientId),
          eq(responsibles.isActive, true),
        ),
      )
      .limit(1);
    return row?.userId ?? null;
  }
  if (owner.memberId) {
    const [row] = await db
      .select({ userId: clientMembers.userId })
      .from(clientMembers)
      .where(
        and(
          eq(clientMembers.id, owner.memberId),
          eq(clientMembers.clientId, clientId),
          eq(clientMembers.isActive, true),
        ),
      )
      .limit(1);
    return row?.userId ?? null;
  }
  return null;
}
