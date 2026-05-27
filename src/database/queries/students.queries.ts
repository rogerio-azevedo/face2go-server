import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { responsibleStudents, schoolClasses, students } from '../schema';

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
      photoKey: students.photoKey,
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

/** Alunos do responsável com nome da turma (`school_classes`), quando existir. */
export async function listStudentsWithClassByResponsible(
  db: AppDb,
  clientId: string,
  responsibleId: string,
) {
  const ids = await listStudentIdsForResponsible(db, responsibleId);
  if (ids.length === 0) return [];
  return db
    .select({
      id: students.id,
      name: students.name,
      photoKey: students.photoKey,
      isActive: students.isActive,
      className: schoolClasses.name,
    })
    .from(students)
    .leftJoin(schoolClasses, eq(students.classId, schoolClasses.id))
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
      | 'situacaoMatricula'
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

export async function findStudentByEnrollment(
  db: AppDb,
  clientId: string,
  enrollment: string,
) {
  const [row] = await db
    .select()
    .from(students)
    .where(
      and(eq(students.clientId, clientId), eq(students.enrollment, enrollment)),
    )
    .limit(1);
  return row;
}

export type UpsertStudentByEnrollmentInput = {
  clientId: string;
  enrollment: string;
  name: string;
  birthDate?: Date | null;
  classId?: string | null;
  situacaoMatricula?:
    | 'enrolled'
    | 'transferred'
    | 'cancelled'
    | 'pre_enrolled'
    | null;
  isActive: boolean;
};

export async function upsertStudentByEnrollment(
  db: AppDb,
  input: UpsertStudentByEnrollmentInput,
): Promise<{ row: typeof students.$inferSelect; created: boolean }> {
  const existing = await findStudentByEnrollment(
    db,
    input.clientId,
    input.enrollment,
  );
  if (existing) {
    const row = await updateStudent(db, existing.id, input.clientId, {
      name: input.name,
      birthDate: input.birthDate,
      classId: input.classId,
      situacaoMatricula: input.situacaoMatricula,
      isActive: input.isActive,
    });
    return { row: row!, created: false };
  }
  const row = await insertStudent(db, {
    clientId: input.clientId,
    enrollment: input.enrollment,
    name: input.name,
    birthDate: input.birthDate ?? null,
    classId: input.classId ?? null,
    situacaoMatricula: input.situacaoMatricula ?? null,
    isActive: input.isActive,
  });
  return { row: row!, created: true };
}

export async function deactivateStudentsNotInList(
  db: AppDb,
  clientId: string,
  activeEnrollments: string[],
): Promise<number> {
  if (activeEnrollments.length === 0) {
    const rows = await db
      .update(students)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(students.clientId, clientId), eq(students.isActive, true)))
      .returning({ id: students.id });
    return rows.length;
  }
  const rows = await db
    .update(students)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(
        eq(students.clientId, clientId),
        eq(students.isActive, true),
        notInArray(students.enrollment, activeEnrollments),
      ),
    )
    .returning({ id: students.id });
  return rows.length;
}
