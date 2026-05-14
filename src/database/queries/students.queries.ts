import { and, asc, eq, inArray } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { parentStudents, students } from '../schema';

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

export async function listStudentIdsForParent(
  db: AppDb,
  parentId: string,
): Promise<string[]> {
  const rows = await db
    .select({ studentId: parentStudents.studentId })
    .from(parentStudents)
    .where(eq(parentStudents.parentId, parentId));
  return rows.map((r) => r.studentId);
}

export async function listStudentsByParent(
  db: AppDb,
  clientId: string,
  parentId: string,
) {
  const ids = await listStudentIdsForParent(db, parentId);
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
