import { and, asc, eq, isNotNull } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { clientAddresses, clients } from '../schema';

export type ClientMapPointRow = {
  id: string;
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  city: string | null;
  state: string | null;
};

export async function listClientMapPoints(
  db: AppDb,
  companyId: string,
): Promise<ClientMapPointRow[]> {
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      type: clients.type,
      latitude: clientAddresses.latitude,
      longitude: clientAddresses.longitude,
      city: clientAddresses.city,
      state: clientAddresses.state,
    })
    .from(clients)
    .innerJoin(
      clientAddresses,
      and(
        eq(clientAddresses.clientId, clients.id),
        eq(clientAddresses.isPrimary, true),
      ),
    )
    .where(
      and(
        eq(clients.companyId, companyId),
        eq(clients.isActive, true),
        isNotNull(clientAddresses.latitude),
        isNotNull(clientAddresses.longitude),
      ),
    )
    .orderBy(asc(clients.name));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type ?? 'other',
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    city: row.city,
    state: row.state,
  }));
}
