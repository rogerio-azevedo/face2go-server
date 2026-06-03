import { and, asc, eq } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { cameras, clientDisplayDevices, facialReaders } from '../schema';

export type ClientDisplayDeviceType = 'lpr_camera' | 'facial_reader';

export type ClientDisplayDeviceRow = {
  deviceType: ClientDisplayDeviceType;
  deviceId: string;
};

export type DisplayDeviceListItem = {
  id: string;
  name: string;
  direction: 'in' | 'out' | null;
  isActive: boolean;
  isEnabled: boolean;
};

export type ClientDisplayDevicesResponse = {
  hasConfiguredDevices: boolean;
  lprCameras: DisplayDeviceListItem[];
  facialReaders: DisplayDeviceListItem[];
};

export async function listDisplayDevices(
  db: AppDb,
  clientId: string,
): Promise<ClientDisplayDeviceRow[]> {
  const rows = await db
    .select({
      deviceType: clientDisplayDevices.deviceType,
      deviceId: clientDisplayDevices.deviceId,
    })
    .from(clientDisplayDevices)
    .where(eq(clientDisplayDevices.clientId, clientId));

  return rows.map((row) => ({
    deviceType: row.deviceType,
    deviceId: row.deviceId,
  }));
}

export async function getDisplayDevicesForClient(
  db: AppDb,
  clientId: string,
): Promise<ClientDisplayDevicesResponse> {
  const [configured, lprRows, readerRows] = await Promise.all([
    listDisplayDevices(db, clientId),
    db
      .select({
        id: cameras.id,
        name: cameras.name,
        direction: cameras.direction,
        isActive: cameras.isActive,
      })
      .from(cameras)
      .where(and(eq(cameras.clientId, clientId), eq(cameras.type, 'lpr')))
      .orderBy(asc(cameras.name)),
    db
      .select({
        id: facialReaders.id,
        name: facialReaders.name,
        direction: facialReaders.direction,
        isActive: facialReaders.isActive,
      })
      .from(facialReaders)
      .where(eq(facialReaders.clientId, clientId))
      .orderBy(asc(facialReaders.name)),
  ]);

  const enabledSet = new Set(
    configured.map((d) => `${d.deviceType}:${d.deviceId}`),
  );
  const hasConfiguredDevices = configured.length > 0;

  return {
    hasConfiguredDevices,
    lprCameras: lprRows.map((row) => ({
      id: row.id,
      name: row.name,
      direction: row.direction ?? null,
      isActive: row.isActive,
      isEnabled: hasConfiguredDevices
        ? enabledSet.has(`lpr_camera:${row.id}`)
        : false,
    })),
    facialReaders: readerRows.map((row) => ({
      id: row.id,
      name: row.name,
      direction: row.direction ?? null,
      isActive: row.isActive,
      isEnabled: hasConfiguredDevices
        ? enabledSet.has(`facial_reader:${row.id}`)
        : false,
    })),
  };
}

export async function setDisplayDevices(
  db: AppDb,
  clientId: string,
  devices: ClientDisplayDeviceRow[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(clientDisplayDevices)
      .where(eq(clientDisplayDevices.clientId, clientId));

    if (devices.length === 0) {
      return;
    }

    await tx.insert(clientDisplayDevices).values(
      devices.map((device) => ({
        clientId,
        deviceType: device.deviceType,
        deviceId: device.deviceId,
      })),
    );
  });
}

export async function validateDisplayDevicesForClient(
  db: AppDb,
  clientId: string,
  devices: ClientDisplayDeviceRow[],
): Promise<boolean> {
  if (devices.length === 0) {
    return true;
  }

  const lprIds = devices
    .filter((d) => d.deviceType === 'lpr_camera')
    .map((d) => d.deviceId);
  const readerIds = devices
    .filter((d) => d.deviceType === 'facial_reader')
    .map((d) => d.deviceId);

  if (lprIds.length > 0) {
    const rows = await db
      .select({ id: cameras.id })
      .from(cameras)
      .where(and(eq(cameras.clientId, clientId), eq(cameras.type, 'lpr')));
    const validIds = new Set(rows.map((r) => r.id));
    if (!lprIds.every((id) => validIds.has(id))) {
      return false;
    }
  }

  if (readerIds.length > 0) {
    const rows = await db
      .select({ id: facialReaders.id })
      .from(facialReaders)
      .where(eq(facialReaders.clientId, clientId));
    const validIds = new Set(rows.map((r) => r.id));
    if (!readerIds.every((id) => validIds.has(id))) {
      return false;
    }
  }

  return true;
}
