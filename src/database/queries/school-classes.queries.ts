import { and, asc, eq } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { schoolClasses, shifts } from '../schema';

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
    .limit(1);
  return row;
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
  const row = await insertSchoolClass(db, {
    clientId,
    name,
    shiftId: null,
    shift: null,
    year,
    isActive: true,
  });
  return { id: row!.id, created: true };
}
