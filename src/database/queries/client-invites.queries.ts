import { and, desc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import {
  clientInvites,
  temporaryPickupAuthorizations,
} from '../schema';

export type ClientInviteRow = typeof clientInvites.$inferSelect;

function isInviteStatus(s: string): s is ClientInviteRow['status'] {
  return s === 'active' || s === 'used' || s === 'expired' || s === 'cancelled';
}

export async function inviteInsert(
  db: AppDb,
  row: typeof clientInvites.$inferInsert,
): Promise<ClientInviteRow | undefined> {
  const rows = await db.insert(clientInvites).values(row).returning();
  return rows[0];
}

export async function inviteGetById(
  db: AppDb,
  id: string,
  clientId: string,
) {
  const rows = await db
    .select()
    .from(clientInvites)
    .where(and(eq(clientInvites.id, id), eq(clientInvites.clientId, clientId)))
    .limit(1);
  return rows[0];
}

export async function inviteGetByGuestLinkCode(db: AppDb, code: string) {
  const rows = await db
    .select()
    .from(clientInvites)
    .where(eq(clientInvites.guestLinkCode, code.trim()))
    .limit(1);
  return rows[0];
}

export async function inviteListByClient(
  db: AppDb,
  clientId: string,
  filters: { status?: string },
) {
  const conditions: SQL[] = [eq(clientInvites.clientId, clientId)];
  if (filters.status && isInviteStatus(filters.status)) {
    conditions.push(eq(clientInvites.status, filters.status));
  }
  return db
    .select()
    .from(clientInvites)
    .where(and(...conditions))
    .orderBy(desc(clientInvites.createdAt));
}

export async function inviteListByMember(
  db: AppDb,
  memberId: string,
  clientId: string,
) {
  return db
    .select()
    .from(clientInvites)
    .where(
      and(
        eq(clientInvites.requestedByMemberId, memberId),
        eq(clientInvites.clientId, clientId),
      ),
    )
    .orderBy(desc(clientInvites.createdAt));
}

export async function inviteUpdate(
  db: AppDb,
  id: string,
  clientId: string,
  patch: Partial<typeof clientInvites.$inferInsert>,
): Promise<ClientInviteRow | undefined> {
  const rows = await db
    .update(clientInvites)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(clientInvites.id, id), eq(clientInvites.clientId, clientId)))
    .returning();
  return rows[0];
}

export async function inviteDelete(
  db: AppDb,
  id: string,
  clientId: string,
  requestedByMemberId?: string,
): Promise<boolean> {
  const conditions: SQL[] = [
    eq(clientInvites.id, id),
    eq(clientInvites.clientId, clientId),
    inArray(clientInvites.status, ['cancelled', 'expired', 'used']),
  ];
  if (requestedByMemberId) {
    conditions.push(eq(clientInvites.requestedByMemberId, requestedByMemberId));
  }
  const rows = await db
    .delete(clientInvites)
    .where(and(...conditions))
    .returning({ id: clientInvites.id });
  return rows.length > 0;
}

export async function inviteFindActiveByGuestDocumentForRequester(
  db: AppDb,
  clientId: string,
  requestedByMemberId: string,
  guestDocument: string,
): Promise<ClientInviteRow | undefined> {
  const now = new Date();
  const [row] = await db
    .select()
    .from(clientInvites)
    .where(
      and(
        eq(clientInvites.clientId, clientId),
        eq(clientInvites.requestedByMemberId, requestedByMemberId),
        eq(clientInvites.guestDocument, guestDocument),
        eq(clientInvites.status, 'active'),
        lte(clientInvites.validFrom, now),
        gte(clientInvites.validUntil, now),
      ),
    )
    .orderBy(desc(clientInvites.createdAt))
    .limit(1);
  return row;
}

export async function inviteFindActiveByGuestFaceId(
  db: AppDb,
  clientId: string,
  guestFaceId: number,
): Promise<
  Array<{
    id: string;
    requestedByMemberId: string;
    guestName: string | null;
    guestFaceImageKey: string | null;
    guestDocument: string | null;
    guestVehiclePlate: string | null;
  }>
> {
  const now = new Date();
  return db
    .select({
      id: clientInvites.id,
      requestedByMemberId: clientInvites.requestedByMemberId,
      guestName: clientInvites.guestName,
      guestFaceImageKey: clientInvites.guestFaceImageKey,
      guestDocument: clientInvites.guestDocument,
      guestVehiclePlate: clientInvites.guestVehiclePlate,
    })
    .from(clientInvites)
    .where(
      and(
        eq(clientInvites.clientId, clientId),
        eq(clientInvites.guestFaceId, guestFaceId),
        eq(clientInvites.status, 'active'),
        eq(clientInvites.guestApprovalStatus, 'approved'),
        lte(clientInvites.validFrom, now),
        gte(clientInvites.validUntil, now),
      ),
    )
    .orderBy(desc(clientInvites.createdAt));
}

export async function inviteFindActiveGuestByPlate(
  db: AppDb,
  clientId: string,
  plate: string,
): Promise<{
  id: string;
  guestName: string | null;
  guestFaceImageKey: string | null;
  guestVehiclePlate: string | null;
  requestedByMemberId: string;
} | null> {
  const normalizedPlate = plate.trim().toUpperCase();
  if (!normalizedPlate) return null;

  const now = new Date();
  const [row] = await db
    .select({
      id: clientInvites.id,
      guestName: clientInvites.guestName,
      guestFaceImageKey: clientInvites.guestFaceImageKey,
      guestVehiclePlate: clientInvites.guestVehiclePlate,
      requestedByMemberId: clientInvites.requestedByMemberId,
    })
    .from(clientInvites)
    .where(
      and(
        eq(clientInvites.clientId, clientId),
        eq(clientInvites.status, 'active'),
        eq(clientInvites.guestApprovalStatus, 'approved'),
        eq(clientInvites.guestVehiclePlate, normalizedPlate),
        lte(clientInvites.validFrom, now),
        gte(clientInvites.validUntil, now),
      ),
    )
    .orderBy(desc(clientInvites.createdAt))
    .limit(1);

  return row ?? null;
}

export async function inviteUpdateStatus(
  db: AppDb,
  id: string,
  clientId: string,
  status: ClientInviteRow['status'],
  extras: { usedAt?: Date | null; guestFaceId?: null },
) {
  const rows = await db
    .update(clientInvites)
    .set({
      status,
      updatedAt: new Date(),
      ...(extras.usedAt !== undefined ? { usedAt: extras.usedAt } : {}),
      ...(extras.guestFaceId !== undefined ? { guestFaceId: extras.guestFaceId } : {}),
    })
    .where(and(eq(clientInvites.id, id), eq(clientInvites.clientId, clientId)))
    .returning();
  return rows[0];
}

export async function inviteUpdateGuestLinkCode(
  db: AppDb,
  id: string,
  clientId: string,
  guestLinkCode: string,
) {
  const rows = await db
    .update(clientInvites)
    .set({ guestLinkCode, updatedAt: new Date() })
    .where(and(eq(clientInvites.id, id), eq(clientInvites.clientId, clientId)))
    .returning();
  return rows[0];
}

export async function inviteUpdateGuestFaceSubmitted(
  db: AppDb,
  id: string,
  guestFaceImageKey: string,
) {
  const rows = await db
    .update(clientInvites)
    .set({
      guestFaceImageKey,
      guestApprovalStatus: 'submitted',
      updatedAt: new Date(),
    })
    .where(eq(clientInvites.id, id))
    .returning();
  return rows[0];
}

export async function inviteUpdateGuestProfile(
  db: AppDb,
  id: string,
  patch: {
    guestName: string;
    guestDocument: string;
    guestPhone?: string | null;
  },
) {
  const rows = await db
    .update(clientInvites)
    .set({
      guestName: patch.guestName,
      guestDocument: patch.guestDocument,
      ...(patch.guestPhone !== undefined ? { guestPhone: patch.guestPhone } : {}),
      updatedAt: new Date(),
    })
    .where(eq(clientInvites.id, id))
    .returning();
  return rows[0];
}

export async function inviteUpdateGuestApproval(
  db: AppDb,
  id: string,
  clientId: string,
  patch: Partial<{
    guestApprovalStatus: ClientInviteRow['guestApprovalStatus'];
    guestFaceImageKey: string | null;
    guestFaceId: number | null;
    guestFaceSyncStatus: ClientInviteRow['guestFaceSyncStatus'];
    guestFaceSyncedAt: Date | null;
    guestFaceSyncError: string | null;
    guestVehicleLprSyncStatus: ClientInviteRow['guestVehicleLprSyncStatus'];
    guestVehicleLprSyncedAt: Date | null;
    guestVehicleLprSyncError: string | null;
  }>,
) {
  const rows = await db
    .update(clientInvites)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(clientInvites.id, id), eq(clientInvites.clientId, clientId)))
    .returning();
  return rows[0];
}

export async function inviteExpireStaleActives(db: AppDb, clientId: string) {
  await db
    .update(clientInvites)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(
      and(
        eq(clientInvites.clientId, clientId),
        eq(clientInvites.status, 'active'),
        lte(clientInvites.validUntil, new Date()),
      ),
    );
}

/** Verifica se o código já existe em convites ou autorizações de retirada. */
export async function isGuestLinkCodeTaken(
  db: AppDb,
  code: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: clientInvites.id })
    .from(clientInvites)
    .where(eq(clientInvites.guestLinkCode, code))
    .limit(1);
  if (rows.length > 0) return true;

  const pickupRows = await db
    .select({ id: temporaryPickupAuthorizations.id })
    .from(temporaryPickupAuthorizations)
    .where(eq(temporaryPickupAuthorizations.guestLinkCode, code))
    .limit(1);
  return pickupRows.length > 0;
}
