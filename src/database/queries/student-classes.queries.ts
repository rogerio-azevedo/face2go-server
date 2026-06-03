import { and, asc, eq, inArray, isNotNull, notInArray } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import {
  responsibles,
  responsibleStudents,
  schoolClasses,
  shifts,
  studentClasses,
} from '../schema';

export type StudentClassLinkRow = {
  id: string;
  studentId: string;
  classId: string;
  className: string;
  shiftId: string | null;
  linkedShiftName: string | null;
  shift: string | null;
  year: number;
  situacaoMatricula: string | null;
  isActive: boolean;
  createdAt: Date;
};

export async function listClassesByStudent(
  db: AppDb,
  studentId: string,
): Promise<StudentClassLinkRow[]> {
  const rows = await db
    .select({
      id: studentClasses.id,
      studentId: studentClasses.studentId,
      classId: studentClasses.classId,
      className: schoolClasses.name,
      shiftId: schoolClasses.shiftId,
      linkedShiftName: shifts.name,
      shift: schoolClasses.shift,
      year: schoolClasses.year,
      situacaoMatricula: studentClasses.situacaoMatricula,
      isActive: studentClasses.isActive,
      createdAt: studentClasses.createdAt,
    })
    .from(studentClasses)
    .innerJoin(schoolClasses, eq(studentClasses.classId, schoolClasses.id))
    .leftJoin(shifts, eq(schoolClasses.shiftId, shifts.id))
    .where(eq(studentClasses.studentId, studentId))
    .orderBy(asc(studentClasses.createdAt));

  return rows.map((r) => ({
    ...r,
    shift: r.shift ?? null,
    situacaoMatricula: r.situacaoMatricula ?? null,
  }));
}

export async function listClassesByStudentIds(
  db: AppDb,
  studentIds: string[],
): Promise<StudentClassLinkRow[]> {
  if (studentIds.length === 0) return [];

  const rows = await db
    .select({
      id: studentClasses.id,
      studentId: studentClasses.studentId,
      classId: studentClasses.classId,
      className: schoolClasses.name,
      shiftId: schoolClasses.shiftId,
      linkedShiftName: shifts.name,
      shift: schoolClasses.shift,
      year: schoolClasses.year,
      situacaoMatricula: studentClasses.situacaoMatricula,
      isActive: studentClasses.isActive,
      createdAt: studentClasses.createdAt,
    })
    .from(studentClasses)
    .innerJoin(schoolClasses, eq(studentClasses.classId, schoolClasses.id))
    .leftJoin(shifts, eq(schoolClasses.shiftId, shifts.id))
    .where(inArray(studentClasses.studentId, studentIds))
    .orderBy(asc(studentClasses.studentId), asc(studentClasses.createdAt));

  return rows.map((r) => ({
    ...r,
    shift: r.shift ?? null,
    situacaoMatricula: r.situacaoMatricula ?? null,
  }));
}

export type UpsertStudentClassLinkInput = {
  studentId: string;
  classId: string;
  situacaoMatricula?:
    | 'enrolled'
    | 'transferred'
    | 'cancelled'
    | 'pre_enrolled'
    | null;
  isActive: boolean;
};

export async function upsertStudentClassLink(
  db: AppDb,
  input: UpsertStudentClassLinkInput,
): Promise<{ id: string; created: boolean }> {
  const [existing] = await db
    .select({ id: studentClasses.id })
    .from(studentClasses)
    .where(
      and(
        eq(studentClasses.studentId, input.studentId),
        eq(studentClasses.classId, input.classId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(studentClasses)
      .set({
        situacaoMatricula: input.situacaoMatricula ?? null,
        isActive: input.isActive,
      })
      .where(eq(studentClasses.id, existing.id));
    return { id: existing.id, created: false };
  }

  const [row] = await db
    .insert(studentClasses)
    .values({
      studentId: input.studentId,
      classId: input.classId,
      situacaoMatricula: input.situacaoMatricula ?? null,
      isActive: input.isActive,
    })
    .returning({ id: studentClasses.id });

  return { id: row.id, created: true };
}

/**
 * Desativa vínculos ativos duplicados (mesmo nome de turma + ano), mantendo o mais antigo
 * (turma cadastrada primeiro no sistema). Corrige duplicatas de `school_classes` com o mesmo código.
 */
export async function dedupeActiveStudentClassLinksByClassNameYear(
  db: AppDb,
  studentId: string,
): Promise<number> {
  const rows = await db
    .select({
      linkId: studentClasses.id,
      className: schoolClasses.name,
      year: schoolClasses.year,
      classCreatedAt: schoolClasses.createdAt,
      linkCreatedAt: studentClasses.createdAt,
    })
    .from(studentClasses)
    .innerJoin(schoolClasses, eq(studentClasses.classId, schoolClasses.id))
    .where(
      and(
        eq(studentClasses.studentId, studentId),
        eq(studentClasses.isActive, true),
      ),
    )
    .orderBy(asc(studentClasses.createdAt));

  const byTurma = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.className.trim().toLowerCase()}:${row.year}`;
    const list = byTurma.get(key) ?? [];
    list.push(row);
    byTurma.set(key, list);
  }

  const toDeactivate: string[] = [];
  for (const group of byTurma.values()) {
    if (group.length <= 1) continue;
    const sorted = [...group].sort(
      (a, b) =>
        a.classCreatedAt.getTime() - b.classCreatedAt.getTime() ||
        a.linkCreatedAt.getTime() - b.linkCreatedAt.getTime(),
    );
    for (const dup of sorted.slice(1)) {
      toDeactivate.push(dup.linkId);
    }
  }

  if (toDeactivate.length === 0) return 0;

  const deactivated = await db
    .update(studentClasses)
    .set({ isActive: false })
    .where(inArray(studentClasses.id, toDeactivate))
    .returning({ id: studentClasses.id });

  return deactivated.length;
}

export async function deactivateStudentClassLink(
  db: AppDb,
  studentId: string,
  classId: string,
): Promise<boolean> {
  const rows = await db
    .update(studentClasses)
    .set({ isActive: false })
    .where(
      and(
        eq(studentClasses.studentId, studentId),
        eq(studentClasses.classId, classId),
        eq(studentClasses.isActive, true),
      ),
    )
    .returning({ id: studentClasses.id });

  return rows.length > 0;
}

export async function deactivateStudentClassLinksNotInList(
  db: AppDb,
  studentId: string,
  activeClassIds: string[],
): Promise<number> {
  if (activeClassIds.length === 0) {
    const rows = await db
      .update(studentClasses)
      .set({ isActive: false })
      .where(
        and(
          eq(studentClasses.studentId, studentId),
          eq(studentClasses.isActive, true),
        ),
      )
      .returning({ id: studentClasses.id });
    return rows.length;
  }

  const rows = await db
    .update(studentClasses)
    .set({ isActive: false })
    .where(
      and(
        eq(studentClasses.studentId, studentId),
        eq(studentClasses.isActive, true),
        notInArray(studentClasses.classId, activeClassIds),
      ),
    )
    .returning({ id: studentClasses.id });

  return rows.length;
}

/** Mapa studentId → índices de zona ativos (batch para sync global). */
export async function listActiveShiftZoneIndicesByStudentIds(
  db: AppDb,
  studentIds: string[],
): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  if (studentIds.length === 0) return result;

  const rows = await db
    .select({
      studentId: studentClasses.studentId,
      timeZoneIndex: shifts.timeZoneIndex,
    })
    .from(studentClasses)
    .innerJoin(schoolClasses, eq(studentClasses.classId, schoolClasses.id))
    .innerJoin(shifts, eq(schoolClasses.shiftId, shifts.id))
    .where(
      and(
        inArray(studentClasses.studentId, studentIds),
        eq(studentClasses.isActive, true),
        eq(schoolClasses.isActive, true),
        eq(shifts.isActive, true),
        isNotNull(shifts.timeZoneIndex),
      ),
    );

  const byStudent = new Map<string, Set<number>>();
  for (const row of rows) {
    if (row.timeZoneIndex == null) continue;
    const set = byStudent.get(row.studentId) ?? new Set<number>();
    set.add(row.timeZoneIndex);
    byStudent.set(row.studentId, set);
  }

  for (const [studentId, indices] of byStudent) {
    result.set(
      studentId,
      [...indices].sort((a, b) => a - b),
    );
  }
  return result;
}

/** Índices de zona (AccessTimeSchedule) dos turnos das turmas ativas do aluno. */
export async function listActiveShiftZoneIndicesForStudent(
  db: AppDb,
  studentId: string,
): Promise<number[]> {
  const rows = await db
    .select({ timeZoneIndex: shifts.timeZoneIndex })
    .from(studentClasses)
    .innerJoin(schoolClasses, eq(studentClasses.classId, schoolClasses.id))
    .innerJoin(shifts, eq(schoolClasses.shiftId, shifts.id))
    .where(
      and(
        eq(studentClasses.studentId, studentId),
        eq(studentClasses.isActive, true),
        eq(schoolClasses.isActive, true),
        eq(shifts.isActive, true),
        isNotNull(shifts.timeZoneIndex),
      ),
    );

  const indices = rows
    .map((r) => r.timeZoneIndex)
    .filter((n): n is number => n != null);

  return [...new Set(indices)].sort((a, b) => a - b);
}

/** Turnos completos (com schedule) das turmas ativas do aluno — para ensureShiftZone. */
export async function listActiveShiftsForStudent(db: AppDb, studentId: string) {
  const rows = await db
    .select({
      id: shifts.id,
      clientId: shifts.clientId,
      name: shifts.name,
      schedule: shifts.schedule,
      timeZoneIndex: shifts.timeZoneIndex,
      isActive: shifts.isActive,
      createdAt: shifts.createdAt,
      updatedAt: shifts.updatedAt,
    })
    .from(studentClasses)
    .innerJoin(schoolClasses, eq(studentClasses.classId, schoolClasses.id))
    .innerJoin(shifts, eq(schoolClasses.shiftId, shifts.id))
    .where(
      and(
        eq(studentClasses.studentId, studentId),
        eq(studentClasses.isActive, true),
        eq(schoolClasses.isActive, true),
        eq(shifts.isActive, true),
        isNotNull(schoolClasses.shiftId),
      ),
    )
    .orderBy(asc(shifts.timeZoneIndex));

  const byId = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    byId.set(row.id, row);
  }
  return [...byId.values()];
}
