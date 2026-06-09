import { and, desc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import {
  pickupAuthorizationStudents,
  students,
  temporaryPickupAuthorizations,
} from '../schema';

export type PickupAuthRow = typeof temporaryPickupAuthorizations.$inferSelect;

export type PickupAuthStudentLink = {
  studentId: string;
  studentName: string;
};

export async function pickupAuthInsertWithStudents(
  db: AppDb,
  auth: typeof temporaryPickupAuthorizations.$inferInsert,
  studentIds: string[],
): Promise<PickupAuthRow | undefined> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(temporaryPickupAuthorizations)
      .values(auth)
      .returning();
    const row = rows[0];
    if (!row) return undefined;
    if (studentIds.length > 0) {
      await tx.insert(pickupAuthorizationStudents).values(
        studentIds.map((studentId) => ({
          authorizationId: row.id,
          studentId,
        })),
      );
    }
    return row;
  });
}

export async function pickupAuthGetById(
  db: AppDb,
  id: string,
  clientId: string,
) {
  const rows = await db
    .select()
    .from(temporaryPickupAuthorizations)
    .where(
      and(
        eq(temporaryPickupAuthorizations.id, id),
        eq(temporaryPickupAuthorizations.clientId, clientId),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function pickupAuthGetByGuestLinkCode(db: AppDb, code: string) {
  const rows = await db
    .select()
    .from(temporaryPickupAuthorizations)
    .where(eq(temporaryPickupAuthorizations.guestLinkCode, code.trim()))
    .limit(1);
  return rows[0];
}

export async function pickupAuthListStudentsForAuth(
  db: AppDb,
  authorizationId: string,
): Promise<PickupAuthStudentLink[]> {
  return db
    .select({
      studentId: pickupAuthorizationStudents.studentId,
      studentName: students.name,
    })
    .from(pickupAuthorizationStudents)
    .innerJoin(students, eq(pickupAuthorizationStudents.studentId, students.id))
    .where(eq(pickupAuthorizationStudents.authorizationId, authorizationId))
    .orderBy(students.name);
}

export async function pickupAuthListStudentsForAuthIds(
  db: AppDb,
  authorizationIds: string[],
): Promise<Array<PickupAuthStudentLink & { authorizationId: string }>> {
  if (authorizationIds.length === 0) return [];
  return db
    .select({
      authorizationId: pickupAuthorizationStudents.authorizationId,
      studentId: pickupAuthorizationStudents.studentId,
      studentName: students.name,
    })
    .from(pickupAuthorizationStudents)
    .innerJoin(students, eq(pickupAuthorizationStudents.studentId, students.id))
    .where(
      inArray(pickupAuthorizationStudents.authorizationId, authorizationIds),
    )
    .orderBy(students.name);
}

export async function pickupAuthListByClient(
  db: AppDb,
  clientId: string,
  filters: { studentId?: string; status?: string },
) {
  const conditions: SQL[] = [
    eq(temporaryPickupAuthorizations.clientId, clientId),
  ];
  if (filters.status && isPickupStatus(filters.status)) {
    conditions.push(eq(temporaryPickupAuthorizations.status, filters.status));
  }

  if (filters.studentId) {
    return db
      .select({
        auth: temporaryPickupAuthorizations,
      })
      .from(temporaryPickupAuthorizations)
      .innerJoin(
        pickupAuthorizationStudents,
        eq(
          pickupAuthorizationStudents.authorizationId,
          temporaryPickupAuthorizations.id,
        ),
      )
      .where(
        and(
          ...conditions,
          eq(pickupAuthorizationStudents.studentId, filters.studentId),
        ),
      )
      .orderBy(desc(temporaryPickupAuthorizations.createdAt))
      .then((rows) => rows.map((r) => r.auth));
  }

  return db
    .select()
    .from(temporaryPickupAuthorizations)
    .where(and(...conditions))
    .orderBy(desc(temporaryPickupAuthorizations.createdAt));
}

function isPickupStatus(s: string): s is PickupAuthRow['status'] {
  return s === 'active' || s === 'used' || s === 'expired' || s === 'cancelled';
}

export async function pickupAuthListByResponsible(
  db: AppDb,
  responsibleId: string,
  clientId: string,
) {
  return db
    .select()
    .from(temporaryPickupAuthorizations)
    .where(
      and(
        eq(
          temporaryPickupAuthorizations.requestedByResponsibleId,
          responsibleId,
        ),
        eq(temporaryPickupAuthorizations.clientId, clientId),
      ),
    )
    .orderBy(desc(temporaryPickupAuthorizations.createdAt));
}

export async function pickupAuthReplaceStudents(
  db: AppDb,
  authorizationId: string,
  studentIds: string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(pickupAuthorizationStudents)
      .where(eq(pickupAuthorizationStudents.authorizationId, authorizationId));
    if (studentIds.length > 0) {
      await tx.insert(pickupAuthorizationStudents).values(
        studentIds.map((studentId) => ({
          authorizationId,
          studentId,
        })),
      );
    }
  });
}

export async function pickupAuthUpdate(
  db: AppDb,
  id: string,
  clientId: string,
  patch: Partial<typeof temporaryPickupAuthorizations.$inferInsert>,
): Promise<PickupAuthRow | undefined> {
  const rows = await db
    .update(temporaryPickupAuthorizations)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(temporaryPickupAuthorizations.id, id),
        eq(temporaryPickupAuthorizations.clientId, clientId),
      ),
    )
    .returning();
  return rows[0];
}

export async function pickupAuthDelete(
  db: AppDb,
  id: string,
  clientId: string,
  requestedByResponsibleId?: string,
): Promise<boolean> {
  const conditions: SQL[] = [
    eq(temporaryPickupAuthorizations.id, id),
    eq(temporaryPickupAuthorizations.clientId, clientId),
    inArray(temporaryPickupAuthorizations.status, [
      'cancelled',
      'expired',
      'used',
    ]),
  ];
  if (requestedByResponsibleId) {
    conditions.push(
      eq(
        temporaryPickupAuthorizations.requestedByResponsibleId,
        requestedByResponsibleId,
      ),
    );
  }
  const rows = await db
    .delete(temporaryPickupAuthorizations)
    .where(and(...conditions))
    .returning({ id: temporaryPickupAuthorizations.id });
  return rows.length > 0;
}

export async function pickupAuthFindActiveByGuestDocumentForRequester(
  db: AppDb,
  clientId: string,
  requestedByResponsibleId: string,
  guestDocument: string,
): Promise<PickupAuthRow | undefined> {
  const now = new Date();
  const [row] = await db
    .select()
    .from(temporaryPickupAuthorizations)
    .where(
      and(
        eq(temporaryPickupAuthorizations.clientId, clientId),
        eq(
          temporaryPickupAuthorizations.requestedByResponsibleId,
          requestedByResponsibleId,
        ),
        eq(temporaryPickupAuthorizations.guestDocument, guestDocument),
        eq(temporaryPickupAuthorizations.status, 'active'),
        lte(temporaryPickupAuthorizations.validFrom, now),
        gte(temporaryPickupAuthorizations.validUntil, now),
      ),
    )
    .orderBy(desc(temporaryPickupAuthorizations.createdAt))
    .limit(1);
  return row;
}

/** Autorizações ativas cujo guestFaceId coincide com o faceId reconhecido no leitor. */
export async function pickupAuthFindActiveByGuestFaceId(
  db: AppDb,
  clientId: string,
  guestFaceId: number,
): Promise<
  Array<{
    id: string;
    requestedByResponsibleId: string;
    guestName: string | null;
    guestFaceImageKey: string | null;
    linkedResponsibleId: string | null;
    guestDocument: string | null;
    guestVehiclePlate: string | null;
  }>
> {
  const now = new Date();
  return db
    .select({
      id: temporaryPickupAuthorizations.id,
      requestedByResponsibleId:
        temporaryPickupAuthorizations.requestedByResponsibleId,
      guestName: temporaryPickupAuthorizations.guestName,
      guestFaceImageKey: temporaryPickupAuthorizations.guestFaceImageKey,
      linkedResponsibleId: temporaryPickupAuthorizations.linkedResponsibleId,
      guestDocument: temporaryPickupAuthorizations.guestDocument,
      guestVehiclePlate: temporaryPickupAuthorizations.guestVehiclePlate,
    })
    .from(temporaryPickupAuthorizations)
    .where(
      and(
        eq(temporaryPickupAuthorizations.clientId, clientId),
        eq(temporaryPickupAuthorizations.guestFaceId, guestFaceId),
        eq(temporaryPickupAuthorizations.status, 'active'),
        eq(temporaryPickupAuthorizations.guestApprovalStatus, 'approved'),
        lte(temporaryPickupAuthorizations.validFrom, now),
        gte(temporaryPickupAuthorizations.validUntil, now),
      ),
    )
    .orderBy(desc(temporaryPickupAuthorizations.createdAt));
}

/** Autorizações ativas com o mesmo documento do convidado (multi-pai). */
export async function pickupAuthFindActiveByGuestDocument(
  db: AppDb,
  clientId: string,
  guestDocument: string,
): Promise<Array<{ id: string; requestedByResponsibleId: string }>> {
  const now = new Date();
  return db
    .select({
      id: temporaryPickupAuthorizations.id,
      requestedByResponsibleId:
        temporaryPickupAuthorizations.requestedByResponsibleId,
    })
    .from(temporaryPickupAuthorizations)
    .where(
      and(
        eq(temporaryPickupAuthorizations.clientId, clientId),
        eq(temporaryPickupAuthorizations.guestDocument, guestDocument),
        eq(temporaryPickupAuthorizations.status, 'active'),
        eq(temporaryPickupAuthorizations.guestApprovalStatus, 'approved'),
        lte(temporaryPickupAuthorizations.validFrom, now),
        gte(temporaryPickupAuthorizations.validUntil, now),
      ),
    )
    .orderBy(desc(temporaryPickupAuthorizations.createdAt));
}

/** FaceIds de convidados com o mesmo documento (histórico no feed multi-pai). */
export async function pickupAuthListGuestFaceIdsByDocument(
  db: AppDb,
  clientId: string,
  guestDocument: string,
): Promise<
  Array<{
    guestFaceId: number | null;
    guestName: string | null;
    guestFaceImageKey: string | null;
  }>
> {
  return db
    .select({
      guestFaceId: temporaryPickupAuthorizations.guestFaceId,
      guestName: temporaryPickupAuthorizations.guestName,
      guestFaceImageKey: temporaryPickupAuthorizations.guestFaceImageKey,
    })
    .from(temporaryPickupAuthorizations)
    .where(
      and(
        eq(temporaryPickupAuthorizations.clientId, clientId),
        eq(temporaryPickupAuthorizations.guestDocument, guestDocument),
      ),
    )
    .orderBy(desc(temporaryPickupAuthorizations.createdAt));
}

/** Autorizações ativas em que o responsável cadastrado é o retirante vinculado. */
export async function pickupAuthFindActiveByLinkedResponsible(
  db: AppDb,
  clientId: string,
  linkedResponsibleId: string,
): Promise<
  Array<{ id: string; requestedByResponsibleId: string }>
> {
  const now = new Date();
  return db
    .select({
      id: temporaryPickupAuthorizations.id,
      requestedByResponsibleId:
        temporaryPickupAuthorizations.requestedByResponsibleId,
    })
    .from(temporaryPickupAuthorizations)
    .where(
      and(
        eq(temporaryPickupAuthorizations.clientId, clientId),
        eq(temporaryPickupAuthorizations.linkedResponsibleId, linkedResponsibleId),
        eq(temporaryPickupAuthorizations.status, 'active'),
        eq(temporaryPickupAuthorizations.guestApprovalStatus, 'approved'),
        lte(temporaryPickupAuthorizations.validFrom, now),
        gte(temporaryPickupAuthorizations.validUntil, now),
      ),
    )
    .orderBy(desc(temporaryPickupAuthorizations.createdAt));
}

export async function pickupAuthUpdateStatus(
  db: AppDb,
  id: string,
  clientId: string,
  status: PickupAuthRow['status'],
  extras: { usedAt?: Date | null; guestFaceId?: null },
) {
  const rows = await db
    .update(temporaryPickupAuthorizations)
    .set({
      status,
      updatedAt: new Date(),
      ...(extras.usedAt !== undefined ? { usedAt: extras.usedAt } : {}),
      ...(extras.guestFaceId !== undefined ? { guestFaceId: extras.guestFaceId } : {}),
    })
    .where(
      and(
        eq(temporaryPickupAuthorizations.id, id),
        eq(temporaryPickupAuthorizations.clientId, clientId),
      ),
    )
    .returning();
  return rows[0];
}

export async function pickupAuthUpdateGuestLinkCode(
  db: AppDb,
  id: string,
  clientId: string,
  guestLinkCode: string,
) {
  const rows = await db
    .update(temporaryPickupAuthorizations)
    .set({ guestLinkCode, updatedAt: new Date() })
    .where(
      and(
        eq(temporaryPickupAuthorizations.id, id),
        eq(temporaryPickupAuthorizations.clientId, clientId),
      ),
    )
    .returning();
  return rows[0];
}

export async function pickupAuthUpdateGuestFaceSubmitted(
  db: AppDb,
  id: string,
  guestFaceImageKey: string,
) {
  const rows = await db
    .update(temporaryPickupAuthorizations)
    .set({
      guestFaceImageKey,
      guestApprovalStatus: 'submitted',
      updatedAt: new Date(),
    })
    .where(eq(temporaryPickupAuthorizations.id, id))
    .returning();
  return rows[0];
}

export async function pickupAuthUpdateGuestProfile(
  db: AppDb,
  id: string,
  patch: {
    guestName: string;
    guestDocument: string;
    guestPhone?: string | null;
  },
) {
  const rows = await db
    .update(temporaryPickupAuthorizations)
    .set({
      guestName: patch.guestName,
      guestDocument: patch.guestDocument,
      ...(patch.guestPhone !== undefined ? { guestPhone: patch.guestPhone } : {}),
      updatedAt: new Date(),
    })
    .where(eq(temporaryPickupAuthorizations.id, id))
    .returning();
  return rows[0];
}

export async function pickupAuthUpdateGuestApproval(
  db: AppDb,
  id: string,
  clientId: string,
  patch: Partial<{
    guestApprovalStatus: PickupAuthRow['guestApprovalStatus'];
    guestFaceImageKey: string | null;
    guestFaceId: number | null;
    guestFaceSyncStatus: PickupAuthRow['guestFaceSyncStatus'];
    guestFaceSyncedAt: Date | null;
    guestFaceSyncError: string | null;
    guestVehicleLprSyncStatus: PickupAuthRow['guestVehicleLprSyncStatus'];
    guestVehicleLprSyncedAt: Date | null;
    guestVehicleLprSyncError: string | null;
  }>,
) {
  const rows = await db
    .update(temporaryPickupAuthorizations)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(temporaryPickupAuthorizations.id, id),
        eq(temporaryPickupAuthorizations.clientId, clientId),
      ),
    )
    .returning();
  return rows[0];
}

export async function pickupAuthExpireStaleActives(
  db: AppDb,
  clientId: string,
) {
  await db
    .update(temporaryPickupAuthorizations)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(
      and(
        eq(temporaryPickupAuthorizations.clientId, clientId),
        eq(temporaryPickupAuthorizations.status, 'active'),
        lte(temporaryPickupAuthorizations.validUntil, new Date()),
      ),
    );
}

/** Autorização ativa com placa do convidado (para LPR na portaria). */
export async function pickupAuthFindActiveGuestByPlate(
  db: AppDb,
  clientId: string,
  plate: string,
): Promise<{
  id: string;
  guestName: string | null;
  guestFaceImageKey: string | null;
  guestVehiclePlate: string | null;
  linkedResponsibleId: string | null;
  requestedByResponsibleId: string;
} | null> {
  const normalizedPlate = plate.trim().toUpperCase();
  if (!normalizedPlate) return null;

  const now = new Date();
  const [row] = await db
    .select({
      id: temporaryPickupAuthorizations.id,
      guestName: temporaryPickupAuthorizations.guestName,
      guestFaceImageKey: temporaryPickupAuthorizations.guestFaceImageKey,
      guestVehiclePlate: temporaryPickupAuthorizations.guestVehiclePlate,
      linkedResponsibleId: temporaryPickupAuthorizations.linkedResponsibleId,
      requestedByResponsibleId:
        temporaryPickupAuthorizations.requestedByResponsibleId,
    })
    .from(temporaryPickupAuthorizations)
    .where(
      and(
        eq(temporaryPickupAuthorizations.clientId, clientId),
        eq(temporaryPickupAuthorizations.status, 'active'),
        eq(temporaryPickupAuthorizations.guestApprovalStatus, 'approved'),
        eq(temporaryPickupAuthorizations.guestVehiclePlate, normalizedPlate),
        lte(temporaryPickupAuthorizations.validFrom, now),
        gte(temporaryPickupAuthorizations.validUntil, now),
      ),
    )
    .orderBy(desc(temporaryPickupAuthorizations.createdAt))
    .limit(1);

  return row ?? null;
}

export function isGuestLinkCodeTaken(
  db: AppDb,
  code: string,
): Promise<boolean> {
  return db
    .select({ id: temporaryPickupAuthorizations.id })
    .from(temporaryPickupAuthorizations)
    .where(eq(temporaryPickupAuthorizations.guestLinkCode, code))
    .limit(1)
    .then((rows) => rows.length > 0);
}
