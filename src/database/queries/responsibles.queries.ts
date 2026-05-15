import { and, asc, eq, ne } from 'drizzle-orm';

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
      'name' | 'phone' | 'document' | 'isActive'
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
