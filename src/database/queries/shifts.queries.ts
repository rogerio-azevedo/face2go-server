import { and, asc, eq } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { shifts } from '../schema';

export async function listShiftsByClient(db: AppDb, clientId: string) {
  return db
    .select()
    .from(shifts)
    .where(eq(shifts.clientId, clientId))
    .orderBy(asc(shifts.name));
}

export async function getShiftById(db: AppDb, id: string, clientId: string) {
  const [row] = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.id, id), eq(shifts.clientId, clientId)))
    .limit(1);
  return row;
}

export type ShiftInsert = typeof shifts.$inferInsert;

export async function insertShift(db: AppDb, values: ShiftInsert) {
  const now = new Date();
  const [row] = await db
    .insert(shifts)
    .values({
      ...values,
      updatedAt: now,
    })
    .returning();
  return row;
}

export async function updateShift(
  db: AppDb,
  id: string,
  clientId: string,
  patch: Partial<
    Pick<
      typeof shifts.$inferInsert,
      'name' | 'schedule' | 'isActive'
    >
  >,
) {
  const now = new Date();
  const [row] = await db
    .update(shifts)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(shifts.id, id), eq(shifts.clientId, clientId)))
    .returning();
  return row;
}

export async function deleteShift(db: AppDb, id: string, clientId: string) {
  const [row] = await db
    .delete(shifts)
    .where(and(eq(shifts.id, id), eq(shifts.clientId, clientId)))
    .returning({ id: shifts.id });
  return row;
}
