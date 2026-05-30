import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
  type SQL,
} from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { listHouseholdResponsibleIds } from './responsibles.queries';
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
      lprSyncStatus: vehicles.lprSyncStatus,
      lprSyncError: vehicles.lprSyncError,
      lprSyncedAt: vehicles.lprSyncedAt,
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

/**
 * Placa para o display de chegadas: primeiro veículo do próprio responsável;
 * se não houver, primeira placa entre co-responsáveis pelos mesmos alunos.
 */
export async function findVehiclePlateForArrival(
  db: AppDb,
  responsibleId: string,
  clientId: string,
): Promise<string | null> {
  const [own] = await db
    .select({ plate: vehicles.plate })
    .from(vehicles)
    .where(
      and(eq(vehicles.clientId, clientId), eq(vehicles.responsibleId, responsibleId)),
    )
    .orderBy(desc(vehicles.createdAt))
    .limit(1);
  const ownPlate = own?.plate?.trim();
  if (ownPlate) return ownPlate;

  const householdIds = await listHouseholdResponsibleIds(
    db,
    responsibleId,
    clientId,
  );
  const otherDriverIds = householdIds.filter((id) => id !== responsibleId);
  if (otherDriverIds.length === 0) return null;

  const rows = await vehicleListForHousehold(db, otherDriverIds, clientId);
  const fallback = rows[0]?.plate?.trim();
  return fallback || null;
}

export async function findResponsibleByPlate(
  db: AppDb,
  plateNumber: string,
  clientId: string,
): Promise<{ id: string; name: string; photoKey: string | null } | null> {
  const normalizedPlate = plateNumber.trim().toUpperCase();
  if (!normalizedPlate) return null;

  const [row] = await db
    .select({
      id: responsibles.id,
      name: responsibles.name,
      photoKey: responsibles.photoKey,
    })
    .from(vehicles)
    .innerJoin(responsibles, eq(vehicles.responsibleId, responsibles.id))
    .where(
      and(
        eq(vehicles.clientId, clientId),
        eq(vehicles.plate, normalizedPlate),
      ),
    )
    .orderBy(desc(vehicles.createdAt))
    .limit(1);
  return row ?? null;
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

export type VehicleListQueryOptions = {
  search?: string;
  offset?: number;
  limit?: number;
};

function vehicleSearchCondition(search?: string): SQL | undefined {
  const term = search?.trim();
  if (!term) return undefined;
  const pattern = `%${term}%`;
  return or(
    ilike(vehicles.plate, pattern),
    ilike(vehicles.brand, pattern),
    ilike(vehicles.model, pattern),
  );
}

function vehicleClientWhere(clientId: string, search?: string) {
  const searchCond = vehicleSearchCondition(search);
  return searchCond
    ? and(eq(vehicles.clientId, clientId), searchCond)
    : eq(vehicles.clientId, clientId);
}

const vehicleListSelect = {
  id: vehicles.id,
  clientId: vehicles.clientId,
  responsibleId: vehicles.responsibleId,
  plate: vehicles.plate,
  brand: vehicles.brand,
  model: vehicles.model,
  color: vehicles.color,
  createdAt: vehicles.createdAt,
  updatedAt: vehicles.updatedAt,
  lprSyncStatus: vehicles.lprSyncStatus,
  lprSyncError: vehicles.lprSyncError,
  lprSyncedAt: vehicles.lprSyncedAt,
  driverName: responsibles.name,
};

export async function countVehiclesForClient(
  db: AppDb,
  clientId: string,
  options: Pick<VehicleListQueryOptions, 'search'> = {},
) {
  const [row] = await db
    .select({ total: count() })
    .from(vehicles)
    .innerJoin(responsibles, eq(vehicles.responsibleId, responsibles.id))
    .where(vehicleClientWhere(clientId, options.search));
  return Number(row?.total ?? 0);
}

/** Lista veículos da escola (gestão empresa / web), com paginação opcional. */
export async function vehicleListForClient(
  db: AppDb,
  clientId: string,
  options: VehicleListQueryOptions = {},
): Promise<VehicleWithDriverRow[]> {
  const q = db
    .select(vehicleListSelect)
    .from(vehicles)
    .innerJoin(responsibles, eq(vehicles.responsibleId, responsibles.id))
    .where(vehicleClientWhere(clientId, options.search))
    .orderBy(desc(vehicles.createdAt));

  if (options.limit !== undefined) {
    q.limit(options.limit);
  }
  if (options.offset !== undefined) {
    q.offset(options.offset);
  }

  const rows = await q;
  return rows as VehicleWithDriverRow[];
}

export async function vehicleUpdateById(
  db: AppDb,
  id: string,
  clientId: string,
  values: {
    responsibleId: string;
    plate: string;
    brand: string;
    model: string;
    color: string;
  },
) {
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
    .where(and(eq(vehicles.id, id), eq(vehicles.clientId, clientId)))
    .returning();
  return rows[0];
}

export async function vehicleDeleteById(
  db: AppDb,
  id: string,
  clientId: string,
) {
  const rows = await db
    .delete(vehicles)
    .where(and(eq(vehicles.id, id), eq(vehicles.clientId, clientId)))
    .returning({ id: vehicles.id });
  return rows[0];
}

export async function vehicleListByResponsible(
  db: AppDb,
  responsibleId: string,
  clientId: string,
) {
  return db
    .select({
      id: vehicles.id,
      plate: vehicles.plate,
    })
    .from(vehicles)
    .where(
      and(
        eq(vehicles.responsibleId, responsibleId),
        eq(vehicles.clientId, clientId),
      ),
    );
}

export async function vehicleDeleteAllForResponsible(
  db: AppDb,
  responsibleId: string,
  clientId: string,
) {
  return db
    .delete(vehicles)
    .where(
      and(
        eq(vehicles.responsibleId, responsibleId),
        eq(vehicles.clientId, clientId),
      ),
    )
    .returning({ id: vehicles.id, plate: vehicles.plate });
}

export async function vehicleGetWithDriver(
  db: AppDb,
  id: string,
  clientId: string,
): Promise<VehicleWithDriverRow | undefined> {
  const [row] = await db
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
      lprSyncStatus: vehicles.lprSyncStatus,
      lprSyncError: vehicles.lprSyncError,
      lprSyncedAt: vehicles.lprSyncedAt,
      driverName: responsibles.name,
    })
    .from(vehicles)
    .innerJoin(responsibles, eq(vehicles.responsibleId, responsibles.id))
    .where(and(eq(vehicles.id, id), eq(vehicles.clientId, clientId)))
    .limit(1);
  return row as VehicleWithDriverRow | undefined;
}

export type VehicleLprSyncPatch = {
  lprSyncStatus: 'pending_sync' | 'synced' | 'sync_failed';
  lprSyncError?: string | null;
  lprSyncedAt?: Date | null;
};

export async function updateVehicleLprSync(
  db: AppDb,
  vehicleId: string,
  clientId: string,
  patch: VehicleLprSyncPatch,
): Promise<VehicleRow | undefined> {
  const setPayload = {
    updatedAt: new Date(),
    lprSyncStatus: patch.lprSyncStatus,
    ...(patch.lprSyncError !== undefined
      ? { lprSyncError: patch.lprSyncError }
      : {}),
    ...(patch.lprSyncedAt !== undefined
      ? { lprSyncedAt: patch.lprSyncedAt }
      : {}),
  };
  const [row] = await db
    .update(vehicles)
    .set(setPayload)
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.clientId, clientId)))
    .returning();
  return row;
}

/** Todos os veículos com condutor — sincronismo em massa nas câmeras LPR. */
export async function listVehiclesForLprPlateSync(
  db: AppDb,
  clientId: string,
): Promise<VehicleWithDriverRow[]> {
  return vehicleListForClient(db, clientId);
}

/** Veículos `pending_sync` ou `sync_failed` (SSE tipo face-sync). */
export async function listVehiclesPendingLprSync(
  db: AppDb,
  clientId: string,
): Promise<VehicleWithDriverRow[]> {
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
      lprSyncStatus: vehicles.lprSyncStatus,
      lprSyncError: vehicles.lprSyncError,
      lprSyncedAt: vehicles.lprSyncedAt,
      driverName: responsibles.name,
    })
    .from(vehicles)
    .innerJoin(responsibles, eq(vehicles.responsibleId, responsibles.id))
    .where(
      and(
        eq(vehicles.clientId, clientId),
        inArray(vehicles.lprSyncStatus, ['pending_sync', 'sync_failed']),
      ),
    )
    .orderBy(desc(vehicles.createdAt));
  return rows as VehicleWithDriverRow[];
}
