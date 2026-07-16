import { and, asc, eq, ne } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { clientAddresses } from '../schema';

export type ClientAddressRow = typeof clientAddresses.$inferSelect;

export type ClientAddressInsert = {
  clientId: string;
  label?: string;
  isPrimary?: boolean;
  cep?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string;
  latitude?: string | null;
  longitude?: string | null;
  geocodingProvider?: 'here' | 'manual';
  geocodingPrecision?: 'rooftop' | 'street' | 'approximate' | null;
  hereLocationId?: string | null;
};

export type ClientAddressUpdate = Partial<
  Omit<ClientAddressInsert, 'clientId'>
>;

function toNumericString(value: number | undefined): string | null {
  if (value === undefined) return null;
  return value.toFixed(7);
}

export function serializeAddressInput(
  input: ClientAddressInsert | ClientAddressUpdate,
): ClientAddressInsert | ClientAddressUpdate {
  const result = { ...input };
  if ('latitude' in input && typeof input.latitude === 'number') {
    result.latitude = toNumericString(input.latitude);
  }
  if ('longitude' in input && typeof input.longitude === 'number') {
    result.longitude = toNumericString(input.longitude);
  }
  return result;
}

export async function listAddressesByClient(
  db: AppDb,
  clientId: string,
): Promise<ClientAddressRow[]> {
  return db
    .select()
    .from(clientAddresses)
    .where(eq(clientAddresses.clientId, clientId))
    .orderBy(asc(clientAddresses.isPrimary), asc(clientAddresses.label));
}

export async function getAddressById(
  db: AppDb,
  clientId: string,
  addressId: string,
): Promise<ClientAddressRow | null> {
  const rows = await db
    .select()
    .from(clientAddresses)
    .where(
      and(
        eq(clientAddresses.id, addressId),
        eq(clientAddresses.clientId, clientId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getPrimaryAddress(
  db: AppDb,
  clientId: string,
): Promise<ClientAddressRow | null> {
  const rows = await db
    .select()
    .from(clientAddresses)
    .where(
      and(
        eq(clientAddresses.clientId, clientId),
        eq(clientAddresses.isPrimary, true),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function createAddress(
  db: AppDb,
  data: ClientAddressInsert,
): Promise<ClientAddressRow> {
  const rows = await db
    .insert(clientAddresses)
    .values({
      ...data,
      updatedAt: new Date(),
    })
    .returning();
  return rows[0];
}

export async function updateAddress(
  db: AppDb,
  clientId: string,
  addressId: string,
  data: ClientAddressUpdate,
): Promise<ClientAddressRow | null> {
  const rows = await db
    .update(clientAddresses)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(clientAddresses.id, addressId),
        eq(clientAddresses.clientId, clientId),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function deleteAddress(
  db: AppDb,
  clientId: string,
  addressId: string,
): Promise<boolean> {
  const rows = await db
    .delete(clientAddresses)
    .where(
      and(
        eq(clientAddresses.id, addressId),
        eq(clientAddresses.clientId, clientId),
      ),
    )
    .returning({ id: clientAddresses.id });
  return rows.length > 0;
}

export async function clearPrimaryForClient(
  db: AppDb,
  clientId: string,
  exceptId?: string,
): Promise<void> {
  const conditions = [
    eq(clientAddresses.clientId, clientId),
    eq(clientAddresses.isPrimary, true),
  ];
  if (exceptId) {
    conditions.push(ne(clientAddresses.id, exceptId));
  }
  await db
    .update(clientAddresses)
    .set({ isPrimary: false, updatedAt: new Date() })
    .where(and(...conditions));
}

export async function setPrimaryAddress(
  db: AppDb,
  clientId: string,
  addressId: string,
): Promise<ClientAddressRow | null> {
  return db.transaction(async (tx) => {
    await clearPrimaryForClient(tx, clientId, addressId);
    const rows = await tx
      .update(clientAddresses)
      .set({ isPrimary: true, updatedAt: new Date() })
      .where(
        and(
          eq(clientAddresses.id, addressId),
          eq(clientAddresses.clientId, clientId),
        ),
      )
      .returning();
    return rows[0] ?? null;
  });
}
