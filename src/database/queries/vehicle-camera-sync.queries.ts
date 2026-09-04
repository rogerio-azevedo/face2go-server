import { and, eq } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { vehicleCameraSync } from '../schema/vehicle-camera-sync';

export type VehicleCameraSyncStatus = 'synced' | 'sync_failed';

export async function listVehicleCameraSyncByVehicle(
  db: AppDb,
  clientId: string,
  vehicleId: string,
) {
  return db
    .select({
      cameraId: vehicleCameraSync.cameraId,
      status: vehicleCameraSync.status,
      error: vehicleCameraSync.error,
    })
    .from(vehicleCameraSync)
    .where(
      and(
        eq(vehicleCameraSync.clientId, clientId),
        eq(vehicleCameraSync.vehicleId, vehicleId),
      ),
    );
}

export async function upsertVehicleCameraSync(
  db: AppDb,
  input: {
    clientId: string;
    vehicleId: string;
    cameraId: string;
    status: VehicleCameraSyncStatus;
    error: string | null;
  },
) {
  const now = new Date();
  const syncedAt = input.status === 'synced' ? now : null;
  await db
    .insert(vehicleCameraSync)
    .values({
      clientId: input.clientId,
      vehicleId: input.vehicleId,
      cameraId: input.cameraId,
      status: input.status,
      error: input.error,
      syncedAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        vehicleCameraSync.clientId,
        vehicleCameraSync.vehicleId,
        vehicleCameraSync.cameraId,
      ],
      set: {
        status: input.status,
        error: input.error,
        syncedAt,
        updatedAt: now,
      },
    });
}

export async function deleteVehicleCameraSyncByVehicle(
  db: AppDb,
  clientId: string,
  vehicleId: string,
) {
  await db
    .delete(vehicleCameraSync)
    .where(
      and(
        eq(vehicleCameraSync.clientId, clientId),
        eq(vehicleCameraSync.vehicleId, vehicleId),
      ),
    );
}

export async function deleteVehicleCameraSyncByCamera(
  db: AppDb,
  clientId: string,
  cameraId: string,
) {
  await db
    .delete(vehicleCameraSync)
    .where(
      and(
        eq(vehicleCameraSync.clientId, clientId),
        eq(vehicleCameraSync.cameraId, cameraId),
      ),
    );
}

export async function listSyncedVehicleIdsByCamera(
  db: AppDb,
  clientId: string,
  cameraId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ vehicleId: vehicleCameraSync.vehicleId })
    .from(vehicleCameraSync)
    .where(
      and(
        eq(vehicleCameraSync.clientId, clientId),
        eq(vehicleCameraSync.cameraId, cameraId),
        eq(vehicleCameraSync.status, 'synced'),
      ),
    );
  return new Set(rows.map((row) => row.vehicleId));
}
