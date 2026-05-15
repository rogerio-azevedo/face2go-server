import { and, asc, eq, inArray } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { responsibleStudents, students } from '../schema';

export async function listStudentsByClient(db: AppDb, clientId: string) {
  return db
    .select()
    .from(students)
    .where(eq(students.clientId, clientId))
    .orderBy(asc(students.name));
}

export async function listStudentsByClass(
  db: AppDb,
  clientId: string,
  classId: string,
) {
  return db
    .select()
    .from(students)
    .where(
      and(eq(students.clientId, clientId), eq(students.classId, classId)),
    )
    .orderBy(asc(students.name));
}

export async function getStudentById(
  db: AppDb,
  id: string,
  clientId: string,
) {
  const [row] = await db
    .select()
    .from(students)
    .where(and(eq(students.id, id), eq(students.clientId, clientId)))
    .limit(1);
  return row;
}

export async function findStudentByFaceIdAndClientId(
  db: AppDb,
  faceId: number,
  clientId: string,
) {
  const [row] = await db
    .select({
      id: students.id,
      name: students.name,
    })
    .from(students)
    .where(
      and(
        eq(students.clientId, clientId),
        eq(students.faceId, faceId),
        eq(students.isActive, true),
      ),
    )
    .limit(1);
  return row;
}

export async function listStudentIdsForResponsible(
  db: AppDb,
  responsibleId: string,
): Promise<string[]> {
  const rows = await db
    .select({ studentId: responsibleStudents.studentId })
    .from(responsibleStudents)
    .where(eq(responsibleStudents.responsibleId, responsibleId));
  return rows.map((r) => r.studentId);
}

export async function listStudentsByResponsible(
  db: AppDb,
  clientId: string,
  responsibleId: string,
) {
  const ids = await listStudentIdsForResponsible(db, responsibleId);
  if (ids.length === 0) return [];
  return db
    .select()
    .from(students)
    .where(and(eq(students.clientId, clientId), inArray(students.id, ids)))
    .orderBy(asc(students.name));
}

export type StudentInsert = typeof students.$inferInsert;

export async function insertStudent(db: AppDb, values: StudentInsert) {
  const now = new Date();
  const [row] = await db
    .insert(students)
    .values({
      ...values,
      updatedAt: now,
    })
    .returning();
  return row;
}

export async function updateStudent(
  db: AppDb,
  id: string,
  clientId: string,
  patch: Partial<
    Pick<
      typeof students.$inferInsert,
      | 'name'
      | 'enrollment'
      | 'document'
      | 'birthDate'
      | 'classId'
      | 'photoKey'
      | 'faceId'
      | 'deviceSyncStatus'
      | 'deviceSyncedAt'
      | 'deviceSyncError'
      | 'accessSchedule'
      | 'isActive'
    >
  >,
) {
  const now = new Date();
  const [row] = await db
    .update(students)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(students.id, id), eq(students.clientId, clientId)))
    .returning();
  return row;
}

export async function updateStudentFace(
  db: AppDb,
  id: string,
  clientId: string,
  patch: Partial<
    Pick<
      typeof students.$inferInsert,
      | 'photoKey'
      | 'faceId'
      | 'deviceSyncStatus'
      | 'deviceSyncedAt'
      | 'deviceSyncError'
    >
  >,
) {
  return updateStudent(db, id, clientId, patch);
}
