import { and, desc, eq, inArray } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { responsibles, vehicles } from '../schema';

export type VehicleRow = typeof vehicles.$inferSelect;

export async function vehicleInsert(
  db: AppDb,
  values: typeof vehicles.$inferInsert,
) {
  const rows = await db.insert(vehicles).values(values).returning();
  return rows[0];
}

export type VehicleWithDriverRow = typeof vehicles.$inferSelect & {
  driverName: string;
};

export async function vehicleListForHousehold(
  db: AppDb,
  householdResponsibleIds: string[],
  clientId: string,
): Promise<VehicleWithDriverRow[]> {
  if (householdResponsibleIds.length === 0) {
    return [];
  }
  const rows = await db
    .select({
      id: vehicles.id,
      clientId: vehicles.clientId,
      responsibleId: vehicles.responsibleId,
      plate: vehicles.plate,
      brand: vehicles.brand,
      model: vehicles.model,
      color: vehicles.color,
      createdAt: vehicles.createdAt,
      updatedAt: vehicles.updatedAt,
      driverName: responsibles.name,
    })
    .from(vehicles)
    .innerJoin(responsibles, eq(vehicles.responsibleId, responsibles.id))
    .where(
      and(
        eq(vehicles.clientId, clientId),
        inArray(vehicles.responsibleId, householdResponsibleIds),
      ),
    )
    .orderBy(desc(vehicles.createdAt));
  return rows as VehicleWithDriverRow[];
}

export async function vehicleGetById(
  db: AppDb,
  id: string,
  clientId: string,
) {
  const rows = await db
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.id, id), eq(vehicles.clientId, clientId)))
    .limit(1);
  return rows[0];
}

export async function vehicleUpdateForHousehold(
  db: AppDb,
  id: string,
  clientId: string,
  householdResponsibleIds: string[],
  values: {
    responsibleId: string;
    plate: string;
    brand: string;
    model: string;
    color: string;
  },
) {
  if (householdResponsibleIds.length === 0) {
    return undefined;
  }
  const rows = await db
    .update(vehicles)
    .set({
      responsibleId: values.responsibleId,
      plate: values.plate,
      brand: values.brand,
      model: values.model,
      color: values.color,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(vehicles.id, id),
        eq(vehicles.clientId, clientId),
        inArray(vehicles.responsibleId, householdResponsibleIds),
      ),
    )
    .returning();
  return rows[0];
}

export async function vehicleDeleteForHousehold(
  db: AppDb,
  id: string,
  clientId: string,
  householdResponsibleIds: string[],
) {
  if (householdResponsibleIds.length === 0) {
    return undefined;
  }
  const rows = await db
    .delete(vehicles)
    .where(
      and(
        eq(vehicles.id, id),
        eq(vehicles.clientId, clientId),
        inArray(vehicles.responsibleId, householdResponsibleIds),
      ),
    )
    .returning({ id: vehicles.id });
  return rows[0];
}
