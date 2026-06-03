import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import * as clientsQueries from './clients.queries';
import { cameras } from '../schema/cameras';
import { clients } from '../schema';

export type CameraType = 'lpr' | 'ptz' | 'general';

export type CameraDirection = 'in' | 'out';

export type CameraListRow = {
  id: string;
  clientId: string;
  clientName: string;
  type: CameraType;
  direction: CameraDirection | null;
  brand: string;
  name: string;
  description: string | null;
  ip: string;
  port: number;
  serialNumber: string | null;
  model: string | null;
  location: string | null;
  username: string | null;
  hasCredentials: boolean;
  deviceId: string | null;
  deviceToken: string;
  isActive: boolean;
  lastSeenAt: Date | null;
  createdAt: Date;
};

export type CameraDetailRow = Omit<CameraListRow, 'clientName'> & {
  companyId: string;
};

export async function listCameras(
  db: AppDb,
  companyId: string,
  filterClientId?: string,
): Promise<CameraListRow[]> {
  const conditions = [eq(clients.companyId, companyId)];
  if (filterClientId) {
    conditions.push(eq(cameras.clientId, filterClientId));
  }

  const rows = await db
    .select({
      id: cameras.id,
      clientId: cameras.clientId,
      clientName: clients.name,
      type: cameras.type,
      direction: cameras.direction,
      brand: cameras.brand,
      name: cameras.name,
      description: cameras.description,
      ip: cameras.ip,
      port: cameras.port,
      serialNumber: cameras.serialNumber,
      model: cameras.model,
      location: cameras.location,
      username: cameras.username,
      passwordEncrypted: cameras.passwordEncrypted,
      deviceId: cameras.deviceId,
      deviceToken: cameras.deviceToken,
      isActive: cameras.isActive,
      lastSeenAt: cameras.lastSeenAt,
      createdAt: cameras.createdAt,
    })
    .from(cameras)
    .innerJoin(clients, eq(cameras.clientId, clients.id))
    .where(and(...conditions))
    .orderBy(asc(clients.name), asc(cameras.name));

  return rows.map(({ passwordEncrypted, ...r }) => ({
    ...r,
    type: r.type ?? 'general',
    direction: r.direction ?? null,
    hasCredentials: !!(
      r.username?.trim() &&
      passwordEncrypted != null &&
      String(passwordEncrypted).trim() !== ''
    ),
  }));
}

export async function getCameraById(
  db: AppDb,
  cameraId: string,
  companyId: string,
): Promise<CameraDetailRow | undefined> {
  const [row] = await db
    .select({
      id: cameras.id,
      clientId: cameras.clientId,
      companyId: clients.companyId,
      type: cameras.type,
      direction: cameras.direction,
      brand: cameras.brand,
      name: cameras.name,
      description: cameras.description,
      ip: cameras.ip,
      port: cameras.port,
      serialNumber: cameras.serialNumber,
      model: cameras.model,
      location: cameras.location,
      username: cameras.username,
      passwordEncrypted: cameras.passwordEncrypted,
      deviceId: cameras.deviceId,
      deviceToken: cameras.deviceToken,
      isActive: cameras.isActive,
      lastSeenAt: cameras.lastSeenAt,
      createdAt: cameras.createdAt,
    })
    .from(cameras)
    .innerJoin(clients, eq(cameras.clientId, clients.id))
    .where(and(eq(cameras.id, cameraId), eq(clients.companyId, companyId)))
    .limit(1);

  if (!row) return undefined;

  const { passwordEncrypted, ...rest } = row;
  return {
    ...rest,
    type: row.type ?? 'general',
    direction: row.direction ?? null,
    hasCredentials: !!(
      row.username?.trim() &&
      passwordEncrypted != null &&
      String(passwordEncrypted).trim() !== ''
    ),
  };
}

export type CameraCreateInput = {
  companyId: string;
  clientId: string;
  type: CameraType;
  direction?: CameraDirection | null;
  brand: string;
  name: string;
  description?: string | null;
  ip: string;
  port: number;
  serialNumber?: string | null;
  model?: string | null;
  location?: string | null;
  deviceId?: string | null;
  username?: string | null;
  passwordEncrypted?: string | null;
  isActive?: boolean;
};

export async function createCamera(db: AppDb, input: CameraCreateInput) {
  const client = await clientsQueries.getClientById(
    db,
    input.clientId,
    input.companyId,
  );
  if (!client) {
    return undefined;
  }

  const [row] = await db
    .insert(cameras)
    .values({
      clientId: input.clientId,
      type: input.type,
      direction: input.direction ?? null,
      brand: input.brand.trim().toLowerCase(),
      name: input.name.trim(),
      description: input.description?.trim() || null,
      ip: input.ip.trim(),
      port: input.port,
      serialNumber: input.serialNumber?.trim() || null,
      model: input.model?.trim() || null,
      location: input.location?.trim() || null,
      deviceId:
        input.deviceId != null && String(input.deviceId).trim()
          ? String(input.deviceId).trim()
          : null,
      username: input.username?.trim() || null,
      passwordEncrypted: input.passwordEncrypted ?? null,
      isActive: input.isActive ?? true,
    })
    .returning();

  return row;
}

export type CameraUpdateInput = Partial<{
  clientId: string;
  type: CameraType;
  direction: CameraDirection | null;
  brand: string;
  name: string;
  description: string | null;
  ip: string;
  port: number;
  serialNumber: string | null;
  model: string | null;
  location: string | null;
  deviceId: string | null;
  username: string | null;
  passwordEncrypted: string | null;
  isActive: boolean;
}>;

export async function updateCamera(
  db: AppDb,
  cameraId: string,
  companyId: string,
  input: CameraUpdateInput,
) {
  const existing = await getCameraById(db, cameraId, companyId);
  if (!existing) {
    return undefined;
  }

  if (input.clientId !== undefined) {
    const client = await clientsQueries.getClientById(
      db,
      input.clientId,
      companyId,
    );
    if (!client) {
      return undefined;
    }
  }

  const setPayload: Partial<typeof cameras.$inferInsert> = {};

  if (input.clientId !== undefined) setPayload.clientId = input.clientId;
  if (input.type !== undefined) setPayload.type = input.type;
  if (input.direction !== undefined) setPayload.direction = input.direction;
  if (input.brand !== undefined) {
    setPayload.brand = input.brand.trim().toLowerCase();
  }
  if (input.name !== undefined) setPayload.name = input.name.trim();
  if (input.description !== undefined) {
    setPayload.description =
      input.description === null || input.description === ''
        ? null
        : input.description.trim();
  }
  if (input.ip !== undefined) setPayload.ip = input.ip.trim();
  if (input.port !== undefined) setPayload.port = input.port;
  if (input.serialNumber !== undefined) {
    setPayload.serialNumber =
      input.serialNumber === null || input.serialNumber === ''
        ? null
        : input.serialNumber.trim();
  }
  if (input.model !== undefined) {
    setPayload.model =
      input.model === null || input.model === '' ? null : input.model.trim();
  }
  if (input.location !== undefined) {
    setPayload.location =
      input.location === null || input.location === ''
        ? null
        : input.location.trim();
  }
  if (input.deviceId !== undefined) {
    setPayload.deviceId =
      input.deviceId === null || input.deviceId === ''
        ? null
        : String(input.deviceId).trim();
  }
  if (input.username !== undefined) {
    setPayload.username =
      input.username === null || input.username === ''
        ? null
        : input.username.trim();
  }
  if (input.passwordEncrypted !== undefined) {
    setPayload.passwordEncrypted = input.passwordEncrypted;
  }
  if (input.isActive !== undefined) setPayload.isActive = input.isActive;

  if (Object.keys(setPayload).length === 0) {
    const [r] = await db
      .select()
      .from(cameras)
      .where(eq(cameras.id, cameraId))
      .limit(1);
    return r;
  }

  const [updated] = await db
    .update(cameras)
    .set(setPayload)
    .where(eq(cameras.id, cameraId))
    .returning();

  return updated;
}

export async function setCameraActive(
  db: AppDb,
  cameraId: string,
  companyId: string,
  isActive: boolean,
) {
  const existing = await getCameraById(db, cameraId, companyId);
  if (!existing) {
    return undefined;
  }

  const [row] = await db
    .update(cameras)
    .set({ isActive })
    .where(eq(cameras.id, cameraId))
    .returning();

  return row;
}

export function camerasRowToPublic(row: typeof cameras.$inferSelect) {
  const { passwordEncrypted, ...rest } = row;
  return {
    ...rest,
    type: rest.type ?? 'general',
    hasCredentials: !!(
      rest.username?.trim() &&
      passwordEncrypted != null &&
      String(passwordEncrypted).trim() !== ''
    ),
  };
}

export type CameraEventStreamRow = {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  companyId: string;
  brand: string;
  type: CameraType;
  ip: string;
  port: number;
  username: string;
  passwordEncrypted: string;
};

/** Câmera LPR Intelbras com credencial — permit list (TrafficRedList). */
export type CameraLprPlateSyncRow = {
  id: string;
  name: string;
  clientId: string;
  ip: string;
  port: number;
  username: string;
  passwordEncrypted: string;
};

export async function listCamerasForLprPlateSyncByClient(
  db: AppDb,
  clientId: string,
): Promise<CameraLprPlateSyncRow[]> {
  const rows = await db
    .select({
      id: cameras.id,
      name: cameras.name,
      clientId: cameras.clientId,
      ip: cameras.ip,
      port: cameras.port,
      username: cameras.username,
      passwordEncrypted: cameras.passwordEncrypted,
    })
    .from(cameras)
    .innerJoin(clients, eq(cameras.clientId, clients.id))
    .where(
      and(
        eq(cameras.clientId, clientId),
        eq(cameras.isActive, true),
        eq(cameras.type, 'lpr'),
        sql`lower(trim(${cameras.brand})) = 'intelbras'`,
        isNotNull(cameras.username),
        isNotNull(cameras.passwordEncrypted),
      ),
    )
    .orderBy(asc(cameras.name));

  return rows.filter(
    (r) => r.username?.trim() && r.passwordEncrypted?.trim() && r.ip?.trim(),
  ) as CameraLprPlateSyncRow[];
}

export async function getCameraIfEligibleForLprPlateSync(
  db: AppDb,
  cameraId: string,
  companyId: string,
): Promise<CameraLprPlateSyncRow | undefined> {
  const [row] = await db
    .select({
      id: cameras.id,
      name: cameras.name,
      clientId: cameras.clientId,
      ip: cameras.ip,
      port: cameras.port,
      username: cameras.username,
      passwordEncrypted: cameras.passwordEncrypted,
    })
    .from(cameras)
    .innerJoin(clients, eq(cameras.clientId, clients.id))
    .where(
      and(
        eq(cameras.id, cameraId),
        eq(clients.companyId, companyId),
        eq(cameras.isActive, true),
        eq(cameras.type, 'lpr'),
        sql`lower(trim(${cameras.brand})) = 'intelbras'`,
        isNotNull(cameras.username),
        isNotNull(cameras.passwordEncrypted),
      ),
    )
    .limit(1);

  if (
    !row?.username?.trim() ||
    !row.passwordEncrypted?.trim() ||
    !row.ip?.trim()
  )
    return undefined;
  return row as CameraLprPlateSyncRow;
}

export async function listCamerasForEventStream(
  db: AppDb,
): Promise<CameraEventStreamRow[]> {
  const rows = await db
    .select({
      id: cameras.id,
      name: cameras.name,
      clientId: cameras.clientId,
      clientName: clients.name,
      companyId: clients.companyId,
      brand: cameras.brand,
      type: cameras.type,
      ip: cameras.ip,
      port: cameras.port,
      username: cameras.username,
      passwordEncrypted: cameras.passwordEncrypted,
    })
    .from(cameras)
    .innerJoin(clients, eq(cameras.clientId, clients.id))
    .where(
      and(
        eq(cameras.isActive, true),
        eq(cameras.type, 'lpr'),
        sql`lower(trim(${cameras.brand})) = 'intelbras'`,
        isNotNull(cameras.username),
        isNotNull(cameras.passwordEncrypted),
      ),
    )
    .orderBy(asc(clients.name), asc(cameras.name));

  return rows
    .filter(
      (r) =>
        r.username != null &&
        String(r.username).trim() !== '' &&
        r.passwordEncrypted != null &&
        String(r.passwordEncrypted).trim() !== '' &&
        r.ip != null &&
        String(r.ip).trim() !== '',
    )
    .map((r) => ({
      id: r.id,
      name: r.name,
      clientId: r.clientId,
      clientName: r.clientName,
      companyId: r.companyId,
      brand: r.brand.trim().toLowerCase(),
      type: r.type ?? 'lpr',
      ip: r.ip,
      port: r.port,
      username: r.username as string,
      passwordEncrypted: r.passwordEncrypted as string,
    }));
}

export async function getCameraForEventStreamById(
  db: AppDb,
  cameraId: string,
): Promise<CameraEventStreamRow | undefined> {
  const [row] = await db
    .select({
      id: cameras.id,
      name: cameras.name,
      clientId: cameras.clientId,
      clientName: clients.name,
      companyId: clients.companyId,
      brand: cameras.brand,
      type: cameras.type,
      ip: cameras.ip,
      port: cameras.port,
      username: cameras.username,
      passwordEncrypted: cameras.passwordEncrypted,
    })
    .from(cameras)
    .innerJoin(clients, eq(cameras.clientId, clients.id))
    .where(
      and(
        eq(cameras.id, cameraId),
        eq(cameras.isActive, true),
        eq(cameras.type, 'lpr'),
        sql`lower(trim(${cameras.brand})) = 'intelbras'`,
        isNotNull(cameras.username),
        isNotNull(cameras.passwordEncrypted),
      ),
    )
    .limit(1);

  if (!row) return undefined;
  if (
    !row.username?.trim() ||
    !row.passwordEncrypted?.trim() ||
    !row.ip?.trim()
  ) {
    return undefined;
  }

  return {
    id: row.id,
    name: row.name,
    clientId: row.clientId,
    clientName: row.clientName,
    companyId: row.companyId,
    brand: row.brand.trim().toLowerCase(),
    type: row.type ?? 'lpr',
    ip: row.ip,
    port: row.port,
    username: row.username,
    passwordEncrypted: row.passwordEncrypted,
  };
}

export async function updateCameraLastSeenAt(
  db: AppDb,
  cameraId: string,
  at: Date,
): Promise<void> {
  await db
    .update(cameras)
    .set({ lastSeenAt: at })
    .where(eq(cameras.id, cameraId));
}

export type CameraMonitorListRow = {
  id: string;
  clientId: string;
  clientName: string;
  type: CameraType;
  brand: string;
  name: string;
  ip: string;
  port: number;
  isActive: boolean;
  username: string | null;
  hasCredentials: boolean;
  lastSeenAt: Date | null;
  createdAt: Date;
};

export async function listCamerasForMonitorReport(
  db: AppDb,
  companyId: string,
  filterClientId?: string,
): Promise<CameraMonitorListRow[]> {
  const conditions = [eq(clients.companyId, companyId)];
  if (filterClientId) {
    conditions.push(eq(cameras.clientId, filterClientId));
  }

  const rows = await db
    .select({
      id: cameras.id,
      clientId: cameras.clientId,
      clientName: clients.name,
      type: cameras.type,
      brand: cameras.brand,
      name: cameras.name,
      ip: cameras.ip,
      port: cameras.port,
      isActive: cameras.isActive,
      username: cameras.username,
      passwordEncrypted: cameras.passwordEncrypted,
      lastSeenAt: cameras.lastSeenAt,
      createdAt: cameras.createdAt,
    })
    .from(cameras)
    .innerJoin(clients, eq(cameras.clientId, clients.id))
    .where(and(...conditions))
    .orderBy(asc(clients.name), asc(cameras.name));

  return rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    clientName: r.clientName,
    type: r.type ?? 'general',
    brand: r.brand,
    name: r.name,
    ip: r.ip,
    port: r.port,
    isActive: r.isActive,
    username: r.username ?? null,
    hasCredentials: !!(
      r.username?.trim() &&
      r.passwordEncrypted != null &&
      String(r.passwordEncrypted).trim() !== ''
    ),
    lastSeenAt: r.lastSeenAt,
    createdAt: r.createdAt,
  }));
}
