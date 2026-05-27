import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { schoolClasses, shifts, studentClasses } from '../schema';

export type MergeDuplicateSchoolClassesResult = {
  groupsMerged: number;
  classesRemoved: number;
  studentLinksRelocated: number;
  studentLinksRemoved: number;
};

export async function listSchoolClassesByClient(db: AppDb, clientId: string) {
  return db
    .select({
      id: schoolClasses.id,
      clientId: schoolClasses.clientId,
      name: schoolClasses.name,
      shift: schoolClasses.shift,
      shiftId: schoolClasses.shiftId,
      year: schoolClasses.year,
      isActive: schoolClasses.isActive,
      createdAt: schoolClasses.createdAt,
      updatedAt: schoolClasses.updatedAt,
      linkedShiftName: shifts.name,
    })
    .from(schoolClasses)
    .leftJoin(shifts, eq(schoolClasses.shiftId, shifts.id))
    .where(eq(schoolClasses.clientId, clientId))
    .orderBy(asc(schoolClasses.year), asc(schoolClasses.name));
}

export async function getSchoolClassById(
  db: AppDb,
  id: string,
  clientId: string,
) {
  const [row] = await db
    .select({
      id: schoolClasses.id,
      clientId: schoolClasses.clientId,
      name: schoolClasses.name,
      shift: schoolClasses.shift,
      shiftId: schoolClasses.shiftId,
      year: schoolClasses.year,
      isActive: schoolClasses.isActive,
      createdAt: schoolClasses.createdAt,
      updatedAt: schoolClasses.updatedAt,
      linkedShiftName: shifts.name,
    })
    .from(schoolClasses)
    .leftJoin(shifts, eq(schoolClasses.shiftId, shifts.id))
    .where(and(eq(schoolClasses.id, id), eq(schoolClasses.clientId, clientId)))
    .limit(1);
  return row;
}

export type SchoolClassInsert = typeof schoolClasses.$inferInsert;

export async function insertSchoolClass(db: AppDb, values: SchoolClassInsert) {
  const now = new Date();
  const [row] = await db
    .insert(schoolClasses)
    .values({
      ...values,
      updatedAt: now,
    })
    .returning();
  return row;
}

export async function updateSchoolClass(
  db: AppDb,
  id: string,
  clientId: string,
  patch: Partial<
    Pick<
      typeof schoolClasses.$inferInsert,
      'name' | 'shift' | 'shiftId' | 'year' | 'isActive'
    >
  >,
) {
  const now = new Date();
  const [row] = await db
    .update(schoolClasses)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(schoolClasses.id, id), eq(schoolClasses.clientId, clientId)))
    .returning();
  return row;
}

export async function findSchoolClassByNameAndYear(
  db: AppDb,
  clientId: string,
  name: string,
  year: number,
) {
  const [row] = await db
    .select({ id: schoolClasses.id })
    .from(schoolClasses)
    .where(
      and(
        eq(schoolClasses.clientId, clientId),
        eq(schoolClasses.name, name),
        eq(schoolClasses.year, year),
      ),
    )
    .orderBy(asc(schoolClasses.createdAt))
    .limit(1);
  return row;
}

/**
 * Funde turmas duplicadas (mesmo cliente + nome + ano), mantendo a mais antiga.
 * Reaponta ou remove vínculos em `student_classes` antes de apagar a turma duplicada.
 */
export async function mergeDuplicateSchoolClassesForClient(
  db: AppDb,
  clientId: string,
): Promise<MergeDuplicateSchoolClassesResult> {
  const result: MergeDuplicateSchoolClassesResult = {
    groupsMerged: 0,
    classesRemoved: 0,
    studentLinksRelocated: 0,
    studentLinksRemoved: 0,
  };

  const classes = await db
    .select({
      id: schoolClasses.id,
      name: schoolClasses.name,
      year: schoolClasses.year,
      createdAt: schoolClasses.createdAt,
    })
    .from(schoolClasses)
    .where(eq(schoolClasses.clientId, clientId))
    .orderBy(
      asc(schoolClasses.year),
      asc(schoolClasses.name),
      asc(schoolClasses.createdAt),
    );

  const groups = new Map<string, typeof classes>();
  for (const row of classes) {
    const key = `${row.name.trim().toLowerCase()}:${row.year}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    result.groupsMerged += 1;

    const [canonical, ...duplicates] = group;

    const duplicateIds = duplicates.map((d) => d.id);

    const relocated = await db
      .update(studentClasses)
      .set({ classId: canonical.id })
      .where(
        and(
          inArray(studentClasses.classId, duplicateIds),
          sql`NOT EXISTS (
            SELECT 1 FROM ${studentClasses} AS sc2
            WHERE sc2.student_id = ${studentClasses.studentId}
              AND sc2.class_id = ${canonical.id}
          )`,
        ),
      )
      .returning({ id: studentClasses.id });
    result.studentLinksRelocated += relocated.length;

    const activeOnDuplicate = db
      .select({ studentId: studentClasses.studentId })
      .from(studentClasses)
      .where(
        and(
          inArray(studentClasses.classId, duplicateIds),
          eq(studentClasses.isActive, true),
        ),
      );

    await db
      .update(studentClasses)
      .set({ isActive: true })
      .where(
        and(
          eq(studentClasses.classId, canonical.id),
          eq(studentClasses.isActive, false),
          inArray(studentClasses.studentId, activeOnDuplicate),
        ),
      );

    const removed = await db
      .delete(studentClasses)
      .where(inArray(studentClasses.classId, duplicateIds))
      .returning({ id: studentClasses.id });
    result.studentLinksRemoved += removed.length;

    await db
      .delete(schoolClasses)
      .where(inArray(schoolClasses.id, duplicateIds));
    result.classesRemoved += duplicateIds.length;
  }

  return result;
}

export async function findOrCreateSchoolClassByCode(
  db: AppDb,
  clientId: string,
  classCode: string,
  year: number,
): Promise<{ id: string; created: boolean }> {
  const name = classCode.trim();
  const existing = await findSchoolClassByNameAndYear(
    db,
    clientId,
    name,
    year,
  );
  if (existing) {
    return { id: existing.id, created: false };
  }
  try {
    const row = await insertSchoolClass(db, {
      clientId,
      name,
      shiftId: null,
      shift: null,
      year,
      isActive: true,
    });
    return { id: row!.id, created: true };
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code: string }).code)
        : '';
    if (code === '23505') {
      const again = await findSchoolClassByNameAndYear(
        db,
        clientId,
        name,
        year,
      );
      if (again) return { id: again.id, created: false };
    }
    throw err;
  }
}
