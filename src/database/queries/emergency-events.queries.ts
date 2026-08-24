import { and, desc, eq } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import {
  emergencyCheckins,
  emergencyEvents,
  emergencyStatusLog,
  presenceState,
} from '../schema';

export async function getActiveEmergencyForClient(db: AppDb, clientId: string) {
  const [row] = await db
    .select()
    .from(emergencyEvents)
    .where(
      and(
        eq(emergencyEvents.clientId, clientId),
        eq(emergencyEvents.status, 'active'),
      ),
    )
    .orderBy(desc(emergencyEvents.startedAt))
    .limit(1);
  return row ?? null;
}

export async function getEmergencyEventById(
  db: AppDb,
  eventId: string,
  companyId: string,
) {
  const [row] = await db
    .select()
    .from(emergencyEvents)
    .where(
      and(
        eq(emergencyEvents.id, eventId),
        eq(emergencyEvents.companyId, companyId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listEmergencyCheckins(
  db: AppDb,
  emergencyEventId: string,
) {
  return db
    .select()
    .from(emergencyCheckins)
    .where(eq(emergencyCheckins.emergencyEventId, emergencyEventId))
    .orderBy(emergencyCheckins.personName);
}

export async function getEmergencyCheckinById(
  db: AppDb,
  checkinId: string,
  emergencyEventId: string,
) {
  const [row] = await db
    .select()
    .from(emergencyCheckins)
    .where(
      and(
        eq(emergencyCheckins.id, checkinId),
        eq(emergencyCheckins.emergencyEventId, emergencyEventId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function insertEmergencyStatusLog(
  db: AppDb,
  input: {
    emergencyEventId: string;
    checkinId: string;
    fromStatus: typeof emergencyCheckins.$inferSelect.status | null;
    toStatus: typeof emergencyCheckins.$inferSelect.status;
    note?: string | null;
    byUserId: string;
  },
) {
  const [row] = await db
    .insert(emergencyStatusLog)
    .values({
      emergencyEventId: input.emergencyEventId,
      checkinId: input.checkinId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      note: input.note ?? null,
      byUserId: input.byUserId,
    })
    .returning();
  return row;
}

export async function listInsidePresenceForClient(db: AppDb, clientId: string) {
  return db
    .select()
    .from(presenceState)
    .where(
      and(eq(presenceState.clientId, clientId), eq(presenceState.status, 'in')),
    );
}
