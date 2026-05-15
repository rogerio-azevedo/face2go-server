import { and, asc, eq, isNotNull, ne } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { responsibleStudents, responsibles, students } from '../schema';

export async function listResponsiblesByClient(db: AppDb, clientId: string) {
  return db
    .select()
    .from(responsibles)
    .where(eq(responsibles.clientId, clientId))
    .orderBy(asc(responsibles.name));
}

export async function listActiveResponsiblePeersExcept(
  db: AppDb,
  clientId: string,
  excludeResponsibleId: string,
) {
  return db
    .select({
      id: responsibles.id,
      name: responsibles.name,
    })
    .from(responsibles)
    .where(
      and(
        eq(responsibles.clientId, clientId),
        eq(responsibles.isActive, true),
        ne(responsibles.id, excludeResponsibleId),
      ),
    )
    .orderBy(asc(responsibles.name));
}

export async function getResponsibleFaceId(
  db: AppDb,
  responsibleId: string,
  clientId: string,
): Promise<number | null> {
  const rows = await db
    .select({ faceId: responsibles.faceId })
    .from(responsibles)
    .where(and(eq(responsibles.id, responsibleId), eq(responsibles.clientId, clientId)))
    .limit(1);
  const v = rows[0]?.faceId;
  return v == null ? null : v;
}

export async function getResponsibleWithFaceStatus(
  db: AppDb,
  id: string,
  clientId: string,
) {
  const rows = await db
    .select({
      photoKey: responsibles.photoKey,
      faceId: responsibles.faceId,
      deviceSyncStatus: responsibles.deviceSyncStatus,
      deviceSyncedAt: responsibles.deviceSyncedAt,
      deviceSyncError: responsibles.deviceSyncError,
    })
    .from(responsibles)
    .where(and(eq(responsibles.id, id), eq(responsibles.clientId, clientId)))
    .limit(1);
  return rows[0];
}

export async function getResponsibleById(
  db: AppDb,
  id: string,
  clientId: string,
) {
  const rows = await db
    .select()
    .from(responsibles)
    .where(and(eq(responsibles.id, id), eq(responsibles.clientId, clientId)))
    .limit(1);
  return rows[0];
}

export async function getResponsibleByUserId(db: AppDb, userId: string) {
  const rows = await db
    .select()
    .from(responsibles)
    .where(eq(responsibles.userId, userId))
    .limit(1);
  return rows[0];
}

export type ResponsibleInsert = typeof responsibles.$inferInsert;

export async function updateResponsiblePushTokenById(
  db: AppDb,
  responsibleId: string,
  pushToken: string,
) {
  const [row] = await db
    .update(responsibles)
    .set({ pushToken, updatedAt: new Date() })
    .where(eq(responsibles.id, responsibleId))
    .returning({ id: responsibles.id });
  return row;
}

export async function findResponsiblesWithPushTokenForStudent(
  db: AppDb,
  studentId: string,
) {
  return db
    .select({
      id: responsibles.id,
      pushToken: responsibles.pushToken,
    })
    .from(responsibleStudents)
    .innerJoin(
      responsibles,
      eq(responsibleStudents.responsibleId, responsibles.id),
    )
    .where(
      and(
        eq(responsibleStudents.studentId, studentId),
        eq(responsibles.isActive, true),
        isNotNull(responsibles.pushToken),
        ne(responsibles.pushToken, ''),
      ),
    );
}

export async function insertResponsible(
  db: AppDb,
  values: ResponsibleInsert,
) {
  const rows = await db.insert(responsibles).values(values).returning();
  return rows[0];
}

export async function updateResponsible(
  db: AppDb,
  id: string,
  clientId: string,
  values: Partial<
    Pick<
      typeof responsibles.$inferInsert,
      | 'name'
      | 'phone'
      | 'document'
      | 'faceId'
      | 'photoKey'
      | 'deviceSyncStatus'
      | 'deviceSyncedAt'
      | 'deviceSyncError'
      | 'pushToken'
      | 'isActive'
    >
  >,
) {
  const rows = await db
    .update(responsibles)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(responsibles.id, id), eq(responsibles.clientId, clientId)))
    .returning();
  return rows[0];
}

export async function updateResponsibleFace(
  db: AppDb,
  id: string,
  clientId: string,
  values: Partial<
    Pick<
      typeof responsibles.$inferInsert,
      | 'photoKey'
      | 'faceId'
      | 'deviceSyncStatus'
      | 'deviceSyncedAt'
      | 'deviceSyncError'
    >
  >,
) {
  return updateResponsible(db, id, clientId, values);
}

export async function insertResponsibleStudentLink(
  db: AppDb,
  values: typeof responsibleStudents.$inferInsert,
) {
  const [row] = await db.insert(responsibleStudents).values(values).returning();
  return row;
}

export async function deleteResponsibleStudentLink(
  db: AppDb,
  responsibleId: string,
  studentId: string,
) {
  const rows = await db
    .delete(responsibleStudents)
    .where(
      and(
        eq(responsibleStudents.responsibleId, responsibleId),
        eq(responsibleStudents.studentId, studentId),
      ),
    )
    .returning({ id: responsibleStudents.id });
  return rows[0];
}

export async function listResponsibleStudentLinksWithStudents(
  db: AppDb,
  responsibleId: string,
  clientId: string,
) {
  return db
    .select({
      link: responsibleStudents,
      student: students,
    })
    .from(responsibleStudents)
    .innerJoin(students, eq(responsibleStudents.studentId, students.id))
    .where(
      and(
        eq(responsibleStudents.responsibleId, responsibleId),
        eq(students.clientId, clientId),
      ),
    )
    .orderBy(asc(responsibleStudents.createdAt));
}
