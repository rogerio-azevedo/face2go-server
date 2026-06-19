import { and, desc, eq, inArray } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import {
  responsibleInvitationStudents,
  responsibleInvitations,
  responsibles,
  students,
} from '../schema';

export type ResponsibleInvitationRow =
  typeof responsibleInvitations.$inferSelect;

export type InvitationStudentLink = {
  studentId: string;
  studentName: string;
  relationshipType: string;
  isAuthorizedPickup: boolean;
};

export async function invitationInsertWithStudents(
  db: AppDb,
  invitation: typeof responsibleInvitations.$inferInsert,
  studentLinks: Array<{
    studentId: string;
    relationshipType: string;
    isAuthorizedPickup: boolean;
  }>,
): Promise<ResponsibleInvitationRow | undefined> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(responsibleInvitations)
      .values(invitation)
      .returning();
    const row = rows[0];
    if (!row) return undefined;
    if (studentLinks.length > 0) {
      await tx.insert(responsibleInvitationStudents).values(
        studentLinks.map((link) => ({
          invitationId: row.id,
          studentId: link.studentId,
          relationshipType:
            link.relationshipType as (typeof responsibleInvitationStudents.$inferInsert)['relationshipType'],
          isAuthorizedPickup: link.isAuthorizedPickup,
        })),
      );
    }
    return row;
  });
}

export async function invitationGetById(
  db: AppDb,
  id: string,
  clientId: string,
) {
  const rows = await db
    .select()
    .from(responsibleInvitations)
    .where(
      and(
        eq(responsibleInvitations.id, id),
        eq(responsibleInvitations.clientId, clientId),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function invitationGetByGuestLinkCode(db: AppDb, code: string) {
  const rows = await db
    .select()
    .from(responsibleInvitations)
    .where(eq(responsibleInvitations.guestLinkCode, code.trim()))
    .limit(1);
  return rows[0];
}

export async function invitationListStudentsForInvitation(
  db: AppDb,
  invitationId: string,
): Promise<InvitationStudentLink[]> {
  return db
    .select({
      studentId: responsibleInvitationStudents.studentId,
      studentName: students.name,
      relationshipType: responsibleInvitationStudents.relationshipType,
      isAuthorizedPickup: responsibleInvitationStudents.isAuthorizedPickup,
    })
    .from(responsibleInvitationStudents)
    .innerJoin(
      students,
      eq(responsibleInvitationStudents.studentId, students.id),
    )
    .where(eq(responsibleInvitationStudents.invitationId, invitationId))
    .orderBy(students.name);
}

export async function invitationListStudentsForInvitationIds(
  db: AppDb,
  invitationIds: string[],
): Promise<Array<InvitationStudentLink & { invitationId: string }>> {
  if (invitationIds.length === 0) return [];
  return db
    .select({
      invitationId: responsibleInvitationStudents.invitationId,
      studentId: responsibleInvitationStudents.studentId,
      studentName: students.name,
      relationshipType: responsibleInvitationStudents.relationshipType,
      isAuthorizedPickup: responsibleInvitationStudents.isAuthorizedPickup,
    })
    .from(responsibleInvitationStudents)
    .innerJoin(
      students,
      eq(responsibleInvitationStudents.studentId, students.id),
    )
    .where(inArray(responsibleInvitationStudents.invitationId, invitationIds))
    .orderBy(students.name);
}

export async function invitationListByInviter(
  db: AppDb,
  inviterResponsibleId: string,
  clientId: string,
) {
  return db
    .select()
    .from(responsibleInvitations)
    .where(
      and(
        eq(responsibleInvitations.inviterResponsibleId, inviterResponsibleId),
        eq(responsibleInvitations.clientId, clientId),
      ),
    )
    .orderBy(desc(responsibleInvitations.createdAt));
}

export async function invitationUpdate(
  db: AppDb,
  id: string,
  clientId: string,
  patch: Partial<
    Pick<
      typeof responsibleInvitations.$inferInsert,
      | 'status'
      | 'faceApprovalStatus'
      | 'submittedName'
      | 'submittedEmail'
      | 'submittedPhone'
      | 'submittedDocument'
      | 'submittedPasswordHash'
      | 'faceImageKey'
      | 'vehiclePlate'
      | 'vehicleBrand'
      | 'vehicleModel'
      | 'vehicleColor'
      | 'createdResponsibleId'
      | 'faceSyncStatus'
      | 'faceSyncedAt'
      | 'faceSyncError'
      | 'plateLprSyncStatus'
      | 'plateLprSyncedAt'
      | 'plateLprSyncError'
      | 'guestLinkCode'
    >
  >,
) {
  const rows = await db
    .update(responsibleInvitations)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(responsibleInvitations.id, id),
        eq(responsibleInvitations.clientId, clientId),
      ),
    )
    .returning();
  return rows[0];
}

export async function invitationIsLinkCodeTaken(
  db: AppDb,
  code: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: responsibleInvitations.id })
    .from(responsibleInvitations)
    .where(eq(responsibleInvitations.guestLinkCode, code))
    .limit(1);
  return rows.length > 0;
}

export async function invitationGetInviterName(
  db: AppDb,
  inviterResponsibleId: string,
) {
  const rows = await db
    .select({ name: responsibles.name })
    .from(responsibles)
    .where(eq(responsibles.id, inviterResponsibleId))
    .limit(1);
  return rows[0]?.name ?? null;
}
