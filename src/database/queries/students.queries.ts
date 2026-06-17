import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
  type SQL,
} from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { responsibleStudents, studentClasses, students } from '../schema';

import * as studentClassesQueries from './student-classes.queries';
import { unaccentIlike } from './search-utils';

export type StudentListQueryOptions = {
  search?: string;
  offset?: number;
  limit?: number;
};

function studentSearchCondition(search?: string): SQL | undefined {
  const term = search?.trim();
  if (!term) return undefined;
  return or(
    unaccentIlike(students.name, term),
    unaccentIlike(students.enrollment, term),
  );
}

function studentClientWhere(clientId: string, search?: string) {
  const searchCond = studentSearchCondition(search);
  return searchCond
    ? and(eq(students.clientId, clientId), searchCond)
    : eq(students.clientId, clientId);
}

export async function countStudentsByClient(
  db: AppDb,
  clientId: string,
  options: Pick<StudentListQueryOptions, 'search'> = {},
) {
  const [row] = await db
    .select({ total: count() })
    .from(students)
    .where(studentClientWhere(clientId, options.search));
  return Number(row?.total ?? 0);
}

export async function listStudentsByClient(
  db: AppDb,
  clientId: string,
  options: StudentListQueryOptions = {},
) {
  const q = db
    .select()
    .from(students)
    .where(studentClientWhere(clientId, options.search))
    .orderBy(asc(students.name));

  if (options.limit !== undefined) {
    q.limit(options.limit);
  }
  if (options.offset !== undefined) {
    q.offset(options.offset);
  }
  return q;
}

export async function countStudentsByClass(
  db: AppDb,
  clientId: string,
  classId: string,
  options: Pick<StudentListQueryOptions, 'search'> = {},
) {
  const searchCond = studentSearchCondition(options.search);
  const [row] = await db
    .select({ total: count() })
    .from(students)
    .innerJoin(
      studentClasses,
      and(
        eq(studentClasses.studentId, students.id),
        eq(studentClasses.classId, classId),
        eq(studentClasses.isActive, true),
      ),
    )
    .where(
      searchCond
        ? and(eq(students.clientId, clientId), searchCond)
        : eq(students.clientId, clientId),
    );
  return Number(row?.total ?? 0);
}

export async function listStudentsByClass(
  db: AppDb,
  clientId: string,
  classId: string,
  options: StudentListQueryOptions = {},
) {
  const searchCond = studentSearchCondition(options.search);
  const q = db
    .select({
      id: students.id,
      clientId: students.clientId,
      name: students.name,
      enrollment: students.enrollment,
      document: students.document,
      birthDate: students.birthDate,
      photoKey: students.photoKey,
      faceId: students.faceId,
      deviceSyncStatus: students.deviceSyncStatus,
      deviceSyncedAt: students.deviceSyncedAt,
      deviceSyncError: students.deviceSyncError,
      accessSchedule: students.accessSchedule,
      situacaoMatricula: students.situacaoMatricula,
      isActive: students.isActive,
      createdAt: students.createdAt,
      updatedAt: students.updatedAt,
    })
    .from(students)
    .innerJoin(
      studentClasses,
      and(
        eq(studentClasses.studentId, students.id),
        eq(studentClasses.classId, classId),
        eq(studentClasses.isActive, true),
      ),
    )
    .where(
      searchCond
        ? and(eq(students.clientId, clientId), searchCond)
        : eq(students.clientId, clientId),
    )
    .orderBy(asc(students.name));

  if (options.limit !== undefined) {
    q.limit(options.limit);
  }
  if (options.offset !== undefined) {
    q.offset(options.offset);
  }
  return q;
}

export async function getStudentById(db: AppDb, id: string, clientId: string) {
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

/** Alunos do responsável com nome da primeira turma ativa (via `student_classes`). */
export async function listStudentsWithClassByResponsible(
  db: AppDb,
  clientId: string,
  responsibleId: string,
) {
  const ids = await listStudentIdsForResponsible(db, responsibleId);
  if (ids.length === 0) return [];

  const studentRows = await db
    .select({
      id: students.id,
      name: students.name,
      photoKey: students.photoKey,
      isActive: students.isActive,
    })
    .from(students)
    .where(and(eq(students.clientId, clientId), inArray(students.id, ids)))
    .orderBy(asc(students.name));

  const links = await studentClassesQueries.listClassesByStudentIds(db, ids);
  const firstClassByStudent = new Map<string, string>();
  for (const link of links) {
    if (link.isActive && !firstClassByStudent.has(link.studentId)) {
      firstClassByStudent.set(link.studentId, link.className);
    }
  }

  return studentRows.map((s) => ({
    ...s,
    className: firstClassByStudent.get(s.id) ?? null,
  }));
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
  situacaoMatricula?:
    | 'enrolled'
    | 'transferred'
    | 'cancelled'
    | 'pre_enrolled'
    | 'locked'
    | null;
  isActive: boolean;
};

export type UpsertStudentByEnrollmentResult = {
  row: typeof students.$inferSelect;
  created: boolean;
  /** `null` quando o aluno foi criado neste upsert. */
  wasActive: boolean | null;
};

export async function upsertStudentByEnrollment(
  db: AppDb,
  input: UpsertStudentByEnrollmentInput,
): Promise<UpsertStudentByEnrollmentResult> {
  const existing = await findStudentByEnrollment(
    db,
    input.clientId,
    input.enrollment,
  );
  if (existing) {
    const wasActive = existing.isActive;
    const row = await updateStudent(db, existing.id, input.clientId, {
      name: input.name,
      birthDate: input.birthDate,
      situacaoMatricula: input.situacaoMatricula,
      isActive: input.isActive,
    });
    return { row: row, created: false, wasActive };
  }
  const row = await insertStudent(db, {
    clientId: input.clientId,
    enrollment: input.enrollment,
    name: input.name,
    birthDate: input.birthDate ?? null,
    situacaoMatricula: input.situacaoMatricula ?? null,
    isActive: input.isActive,
  });
  return { row: row, created: true, wasActive: null };
}

export type StudentForGlobalSyncRow = {
  id: string;
  name: string;
  faceId: number;
  photoKey: string;
};

/** Alunos com foto e sync pendente/falho — elegíveis para sync global. */
export async function listStudentsForGlobalSync(
  db: AppDb,
  clientId: string,
): Promise<StudentForGlobalSyncRow[]> {
  const rows = await db
    .select({
      id: students.id,
      name: students.name,
      faceId: students.faceId,
      photoKey: students.photoKey,
    })
    .from(students)
    .where(
      and(
        eq(students.clientId, clientId),
        isNotNull(students.faceId),
        isNotNull(students.photoKey),
        or(
          ne(students.deviceSyncStatus, 'synced'),
          isNull(students.deviceSyncStatus),
        ),
      ),
    )
    .orderBy(asc(students.name));

  return rows.filter(
    (r): r is StudentForGlobalSyncRow => r.faceId != null && r.photoKey != null,
  );
}

export type DeactivateStudentsNotInListResult = {
  count: number;
  enrollments: string[];
};

export async function deactivateStudentsNotInList(
  db: AppDb,
  clientId: string,
  activeEnrollments: string[],
): Promise<DeactivateStudentsNotInListResult> {
  if (activeEnrollments.length === 0) {
    const rows = await db
      .update(students)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(students.clientId, clientId), eq(students.isActive, true)))
      .returning({ id: students.id, enrollment: students.enrollment });
    return {
      count: rows.length,
      enrollments: rows.map((r) => r.enrollment),
    };
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
    .returning({ id: students.id, enrollment: students.enrollment });
  return {
    count: rows.length,
    enrollments: rows.map((r) => r.enrollment),
  };
}

export async function deleteAllStudentClassLinks(db: AppDb, studentId: string) {
  return db
    .delete(studentClasses)
    .where(eq(studentClasses.studentId, studentId))
    .returning({ id: studentClasses.id });
}

export async function deleteAllStudentResponsibleLinks(
  db: AppDb,
  studentId: string,
) {
  return db
    .delete(responsibleStudents)
    .where(eq(responsibleStudents.studentId, studentId))
    .returning({ id: responsibleStudents.id });
}
