import { and, eq, inArray, sql } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import {
  cameras,
  clients,
  facialReaders,
  presenceState,
  schoolClasses,
  studentClasses,
} from '../schema';

export type PresenceUpsertInput = {
  companyId: string;
  clientId: string;
  personType: 'student' | 'responsible' | 'member' | 'guest';
  personId: string;
  personName: string;
  status: 'in' | 'out';
  lastDirection: 'in' | 'out' | null;
  lastEventAt: Date;
  lastSource: 'facial' | 'lpr';
  lastDeviceId: string;
  lastDeviceName: string;
};

export async function upsertPresenceState(
  db: AppDb,
  input: PresenceUpsertInput,
) {
  const now = new Date();
  const [row] = await db
    .insert(presenceState)
    .values({
      companyId: input.companyId,
      clientId: input.clientId,
      personType: input.personType,
      personId: input.personId,
      personName: input.personName,
      status: input.status,
      lastDirection: input.lastDirection,
      lastEventAt: input.lastEventAt,
      lastSource: input.lastSource,
      lastDeviceId: input.lastDeviceId,
      lastDeviceName: input.lastDeviceName,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        presenceState.clientId,
        presenceState.personType,
        presenceState.personId,
      ],
      set: {
        personName: input.personName,
        status: input.status,
        lastDirection: input.lastDirection,
        lastEventAt: input.lastEventAt,
        lastSource: input.lastSource,
        lastDeviceId: input.lastDeviceId,
        lastDeviceName: input.lastDeviceName,
        updatedAt: now,
      },
    })
    .returning();
  return row;
}

export async function listPresenceByClient(
  db: AppDb,
  clientId: string,
  status?: 'in' | 'out',
) {
  const conditions = [eq(presenceState.clientId, clientId)];
  if (status) {
    conditions.push(eq(presenceState.status, status));
  }

  return db
    .select()
    .from(presenceState)
    .where(and(...conditions))
    .orderBy(presenceState.personName);
}

export async function listPresenceByCompany(
  db: AppDb,
  companyId: string,
  status?: 'in' | 'out',
) {
  const conditions = [eq(presenceState.companyId, companyId)];
  if (status) {
    conditions.push(eq(presenceState.status, status));
  }

  return db
    .select({
      id: presenceState.id,
      companyId: presenceState.companyId,
      clientId: presenceState.clientId,
      clientName: clients.name,
      personType: presenceState.personType,
      personId: presenceState.personId,
      personName: presenceState.personName,
      status: presenceState.status,
      lastDirection: presenceState.lastDirection,
      lastEventAt: presenceState.lastEventAt,
      lastSource: presenceState.lastSource,
      lastDeviceId: presenceState.lastDeviceId,
      lastDeviceName: presenceState.lastDeviceName,
      updatedAt: presenceState.updatedAt,
    })
    .from(presenceState)
    .innerJoin(clients, eq(presenceState.clientId, clients.id))
    .where(and(...conditions, eq(clients.type, 'school')))
    .orderBy(clients.name, presenceState.personName);
}

export async function resetSchoolPresenceToOut(db: AppDb) {
  return db
    .update(presenceState)
    .set({
      status: 'out',
      updatedAt: new Date(),
    })
    .where(
      sql`${presenceState.clientId} IN (
        SELECT id FROM clients WHERE type = 'school'
      )`,
    );
}

export async function getClientDeviceDirectionSummary(
  db: AppDb,
  clientId: string,
) {
  const [readers] = await db
    .select({
      total: sql<number>`count(*)::int`,
      withDirection: sql<number>`count(${facialReaders.direction})::int`,
    })
    .from(facialReaders)
    .where(
      and(eq(facialReaders.clientId, clientId), eq(facialReaders.isActive, true)),
    );

  const [cams] = await db
    .select({
      total: sql<number>`count(*)::int`,
      withDirection: sql<number>`count(${cameras.direction})::int`,
    })
    .from(cameras)
    .where(and(eq(cameras.clientId, clientId), eq(cameras.isActive, true)));

  return {
    readersTotal: readers?.total ?? 0,
    readersWithDirection: readers?.withDirection ?? 0,
    camerasTotal: cams?.total ?? 0,
    camerasWithDirection: cams?.withDirection ?? 0,
  };
}

export async function listStudentClassNamesByStudentIds(
  db: AppDb,
  studentIds: string[],
) {
  if (studentIds.length === 0) return new Map<string, { classId: string; className: string }>();

  const rows = await db
    .select({
      studentId: studentClasses.studentId,
      classId: schoolClasses.id,
      className: schoolClasses.name,
    })
    .from(studentClasses)
    .innerJoin(schoolClasses, eq(studentClasses.classId, schoolClasses.id))
    .where(
      and(
        inArray(studentClasses.studentId, studentIds),
        eq(studentClasses.isActive, true),
        eq(schoolClasses.isActive, true),
      ),
    );

  const map = new Map<string, { classId: string; className: string }>();
  for (const row of rows) {
    if (!map.has(row.studentId)) {
      map.set(row.studentId, {
        classId: row.classId,
        className: row.className,
      });
    }
  }
  return map;
}
