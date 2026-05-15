import { and, desc, eq, lte, type SQL } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { temporaryPickupAuthorizations } from '../schema';

export type PickupAuthRow = typeof temporaryPickupAuthorizations.$inferSelect;

export async function pickupAuthInsert(
  db: AppDb,
  values: typeof temporaryPickupAuthorizations.$inferInsert,
) {
  const rows = await db
    .insert(temporaryPickupAuthorizations)
    .values(values)
    .returning();
  return rows[0];
}

export async function pickupAuthGetById(
  db: AppDb,
  id: string,
  clientId: string,
) {
  const rows = await db
    .select()
    .from(temporaryPickupAuthorizations)
    .where(
      and(
        eq(temporaryPickupAuthorizations.id, id),
        eq(temporaryPickupAuthorizations.clientId, clientId),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function pickupAuthListByClient(
  db: AppDb,
  clientId: string,
  filters: { studentId?: string; status?: string },
) {
  const conditions: SQL[] = [
    eq(temporaryPickupAuthorizations.clientId, clientId),
  ];
  if (filters.studentId) {
    conditions.push(
      eq(temporaryPickupAuthorizations.studentId, filters.studentId),
    );
  }
  if (filters.status && isPickupStatus(filters.status)) {
    conditions.push(eq(temporaryPickupAuthorizations.status, filters.status));
  }

  return db
    .select()
    .from(temporaryPickupAuthorizations)
    .where(and(...conditions))
    .orderBy(desc(temporaryPickupAuthorizations.createdAt));
}

function isPickupStatus(
  s: string,
): s is PickupAuthRow['status'] {
  return (
    s === 'active' ||
    s === 'used' ||
    s === 'expired' ||
    s === 'cancelled'
  );
}

export async function pickupAuthListByResponsible(
  db: AppDb,
  responsibleId: string,
  clientId: string,
) {
  return db
    .select()
    .from(temporaryPickupAuthorizations)
    .where(
      and(
        eq(
          temporaryPickupAuthorizations.requestedByResponsibleId,
          responsibleId,
        ),
        eq(temporaryPickupAuthorizations.clientId, clientId),
      ),
    )
    .orderBy(desc(temporaryPickupAuthorizations.createdAt));
}

export async function pickupAuthUpdateStatus(
  db: AppDb,
  id: string,
  clientId: string,
  status: PickupAuthRow['status'],
  extras: { usedAt?: Date | null },
) {
  const rows = await db
    .update(temporaryPickupAuthorizations)
    .set({
      status,
      updatedAt: new Date(),
      ...(extras.usedAt !== undefined ? { usedAt: extras.usedAt } : {}),
    })
    .where(
      and(
        eq(temporaryPickupAuthorizations.id, id),
        eq(temporaryPickupAuthorizations.clientId, clientId),
      ),
    )
    .returning();
  return rows[0];
}

export async function pickupAuthExpireStaleActives(db: AppDb, clientId: string) {
  await db
    .update(temporaryPickupAuthorizations)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(
      and(
        eq(temporaryPickupAuthorizations.clientId, clientId),
        eq(temporaryPickupAuthorizations.status, 'active'),
        lte(temporaryPickupAuthorizations.validUntil, new Date()),
      ),
    );
}
