import { and, asc, eq, isNotNull } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { shifts } from '../schema';
import {
  ALWAYS_TIME_ZONE_INDEX,
  MIN_CUSTOM_TIME_ZONE_INDEX,
} from '../../face-sync/intelbras-time-zone.constants';

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
    Pick<typeof shifts.$inferInsert, 'name' | 'schedule' | 'isActive'>
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

export async function listShiftsWithZoneIndexByClient(
  db: AppDb,
  clientId: string,
) {
  return db
    .select()
    .from(shifts)
    .where(and(eq(shifts.clientId, clientId), isNotNull(shifts.timeZoneIndex)))
    .orderBy(asc(shifts.timeZoneIndex));
}

export async function setShiftTimeZoneIndex(
  db: AppDb,
  shiftId: string,
  clientId: string,
  timeZoneIndex: number,
) {
  const now = new Date();
  const [row] = await db
    .update(shifts)
    .set({ timeZoneIndex, updatedAt: now })
    .where(and(eq(shifts.id, shiftId), eq(shifts.clientId, clientId)))
    .returning();
  return row;
}

/**
 * Próximo índice livre de AccessTimeSchedule para o cliente (1..maxZones, reserva 255).
 */
export async function allocateShiftZoneIndex(
  db: AppDb,
  clientId: string,
  maxZones: number,
): Promise<number> {
  const rows = await db
    .select({ timeZoneIndex: shifts.timeZoneIndex })
    .from(shifts)
    .where(and(eq(shifts.clientId, clientId), isNotNull(shifts.timeZoneIndex)));

  const used = new Set(
    rows
      .map((r) => r.timeZoneIndex)
      .filter((n): n is number => n != null && n !== ALWAYS_TIME_ZONE_INDEX),
  );

  for (let i = MIN_CUSTOM_TIME_ZONE_INDEX; i <= maxZones; i++) {
    if (!used.has(i)) return i;
  }

  throw new Error(
    `Limite de ${maxZones} zonas de horário por cliente atingido.`,
  );
}
