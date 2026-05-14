import { and, asc, eq } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { parentStudents, parents, students } from '../schema';

export async function listParentsByClient(db: AppDb, clientId: string) {
  return db
    .select()
    .from(parents)
    .where(eq(parents.clientId, clientId))
    .orderBy(asc(parents.name));
}

export async function getParentById(db: AppDb, id: string, clientId: string) {
  const [row] = await db
    .select()
    .from(parents)
    .where(and(eq(parents.id, id), eq(parents.clientId, clientId)))
    .limit(1);
  return row;
}

export async function getParentByUserId(db: AppDb, userId: string) {
  const [row] = await db
    .select()
    .from(parents)
    .where(eq(parents.userId, userId))
    .limit(1);
  return row;
}

export type ParentInsert = typeof parents.$inferInsert;

export async function insertParent(db: AppDb, values: ParentInsert) {
  const now = new Date();
  const [row] = await db
    .insert(parents)
    .values({
      ...values,
      updatedAt: now,
    })
    .returning();
  return row;
}

export async function updateParent(
  db: AppDb,
  id: string,
  clientId: string,
  patch: Partial<
    Pick<
      typeof parents.$inferInsert,
      'name' | 'phone' | 'document' | 'userId' | 'isActive'
    >
  >,
) {
  const now = new Date();
  const [row] = await db
    .update(parents)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(parents.id, id), eq(parents.clientId, clientId)))
    .returning();
  return row;
}

export async function insertParentStudentLink(
  db: AppDb,
  values: typeof parentStudents.$inferInsert,
) {
  const [row] = await db.insert(parentStudents).values(values).returning();
  return row;
}

export async function deleteParentStudentLink(
  db: AppDb,
  parentId: string,
  studentId: string,
) {
  const [row] = await db
    .delete(parentStudents)
    .where(
      and(
        eq(parentStudents.parentId, parentId),
        eq(parentStudents.studentId, studentId),
      ),
    )
    .returning();
  return row;
}

export async function listParentStudentLinksWithStudents(
  db: AppDb,
  parentId: string,
  clientId: string,
) {
  return db
    .select({
      link: parentStudents,
      student: students,
    })
    .from(parentStudents)
    .innerJoin(students, eq(parentStudents.studentId, students.id))
    .where(
      and(
        eq(parentStudents.parentId, parentId),
        eq(students.clientId, clientId),
      ),
    )
    .orderBy(asc(parentStudents.createdAt));
}
