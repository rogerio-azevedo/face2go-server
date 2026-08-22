import { and, asc, eq, isNotNull } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import * as clientsQueries from './clients.queries';
import { clients, facialReaders } from '../schema';

export type ReaderBrand = 'intelbras' | 'hikvision';

export type ReaderDirection = 'in' | 'out';

export type ReaderListRow = {
  id: string;
  clientId: string;
  clientName: string;
  brand: ReaderBrand;
  direction: ReaderDirection | null;
  name: string;
  description: string | null;
  ip: string;
  port: number;
  serialNumber: string | null;
  model: string | null;
  location: string | null;
  username: string | null;
  hasCredentials: boolean;
  isActive: boolean;
  lastSeenAt: Date | null;
  createdAt: Date;
};

export type ReaderDetailRow = Omit<ReaderListRow, 'clientName'> & {
  companyId: string;
};

export async function listReaders(
  db: AppDb,
  companyId: string,
  filterClientId?: string,
): Promise<ReaderListRow[]> {
  const conditions = [eq(clients.companyId, companyId)];
  if (filterClientId) {
    conditions.push(eq(facialReaders.clientId, filterClientId));
  }

  const rows = await db
    .select({
      id: facialReaders.id,
      clientId: facialReaders.clientId,
      clientName: clients.name,
      brand: facialReaders.brand,
      direction: facialReaders.direction,
      name: facialReaders.name,
      description: facialReaders.description,
      ip: facialReaders.ip,
      port: facialReaders.port,
      serialNumber: facialReaders.serialNumber,
      model: facialReaders.model,
      location: facialReaders.location,
      username: facialReaders.username,
      passwordEncrypted: facialReaders.passwordEncrypted,
      isActive: facialReaders.isActive,
      lastSeenAt: facialReaders.lastSeenAt,
      createdAt: facialReaders.createdAt,
    })
    .from(facialReaders)
    .innerJoin(clients, eq(facialReaders.clientId, clients.id))
    .where(and(...conditions))
    .orderBy(asc(clients.name), asc(facialReaders.name));

  return rows.map(({ passwordEncrypted, ...r }) => ({
    ...r,
    brand: r.brand ?? 'intelbras',
    direction: r.direction ?? null,
    hasCredentials: !!(
      r.username?.trim() &&
      passwordEncrypted != null &&
      String(passwordEncrypted).trim() !== ''
    ),
  }));
}

export async function getReaderById(
  db: AppDb,
  readerId: string,
  companyId: string,
): Promise<ReaderDetailRow | undefined> {
  const [row] = await db
    .select({
      id: facialReaders.id,
      clientId: facialReaders.clientId,
      companyId: clients.companyId,
      brand: facialReaders.brand,
      direction: facialReaders.direction,
      name: facialReaders.name,
      description: facialReaders.description,
      ip: facialReaders.ip,
      port: facialReaders.port,
      serialNumber: facialReaders.serialNumber,
      model: facialReaders.model,
      location: facialReaders.location,
      username: facialReaders.username,
      passwordEncrypted: facialReaders.passwordEncrypted,
      isActive: facialReaders.isActive,
      lastSeenAt: facialReaders.lastSeenAt,
      createdAt: facialReaders.createdAt,
    })
    .from(facialReaders)
    .innerJoin(clients, eq(facialReaders.clientId, clients.id))
    .where(
      and(eq(facialReaders.id, readerId), eq(clients.companyId, companyId)),
    )
    .limit(1);

  if (!row) return undefined;

  const { passwordEncrypted, ...rest } = row;
  return {
    ...rest,
    brand: row.brand ?? 'intelbras',
    direction: row.direction ?? null,
    hasCredentials: !!(
      row.username?.trim() &&
      passwordEncrypted != null &&
      String(passwordEncrypted).trim() !== ''
    ),
  };
}

export async function getReaderWithCredentialsById(
  db: AppDb,
  readerId: string,
  companyId: string,
) {
  const [row] = await db
    .select({
      id: facialReaders.id,
      name: facialReaders.name,
      ip: facialReaders.ip,
      port: facialReaders.port,
      username: facialReaders.username,
      passwordEncrypted: facialReaders.passwordEncrypted,
      brand: facialReaders.brand,
      isActive: facialReaders.isActive,
    })
    .from(facialReaders)
    .innerJoin(clients, eq(facialReaders.clientId, clients.id))
    .where(
      and(eq(facialReaders.id, readerId), eq(clients.companyId, companyId)),
    )
    .limit(1);

  return row;
}

export type ReaderCreateInput = {
  companyId: string;
  clientId: string;
  brand: ReaderBrand;
  direction?: ReaderDirection | null;
  name: string;
  description?: string | null;
  ip: string;
  port: number;
  serialNumber?: string | null;
  model?: string | null;
  location?: string | null;
  username?: string | null;
  passwordEncrypted?: string | null;
  isActive?: boolean;
};

export async function createReader(db: AppDb, input: ReaderCreateInput) {
  const client = await clientsQueries.getClientById(
    db,
    input.clientId,
    input.companyId,
  );
  if (!client) {
    return undefined;
  }

  const [row] = await db
    .insert(facialReaders)
    .values({
      clientId: input.clientId,
      brand: input.brand,
      direction: input.direction ?? null,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      ip: input.ip.trim(),
      port: input.port,
      serialNumber: input.serialNumber?.trim() || null,
      model: input.model?.trim() || null,
      location: input.location?.trim() || null,
      username: input.username?.trim() || null,
      passwordEncrypted: input.passwordEncrypted ?? null,
      isActive: input.isActive ?? true,
    })
    .returning();

  return row;
}

export type ReaderUpdateInput = Partial<{
  clientId: string;
  brand: ReaderBrand;
  direction: ReaderDirection | null;
  name: string;
  description: string | null;
  ip: string;
  port: number;
  serialNumber: string | null;
  model: string | null;
  location: string | null;
  username: string | null;
  passwordEncrypted: string | null;
  isActive: boolean;
}>;

export async function updateReader(
  db: AppDb,
  readerId: string,
  companyId: string,
  input: ReaderUpdateInput,
) {
  const existing = await getReaderById(db, readerId, companyId);
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

  const setPayload: Partial<typeof facialReaders.$inferInsert> = {};

  if (input.clientId !== undefined) setPayload.clientId = input.clientId;
  if (input.brand !== undefined) setPayload.brand = input.brand;
  if (input.direction !== undefined) setPayload.direction = input.direction;
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
    return existing;
  }

  const [row] = await db
    .update(facialReaders)
    .set(setPayload)
    .where(eq(facialReaders.id, readerId))
    .returning();

  return row;
}

export async function setReaderActive(
  db: AppDb,
  readerId: string,
  companyId: string,
  isActive: boolean,
) {
  const existing = await getReaderById(db, readerId, companyId);
  if (!existing) {
    return undefined;
  }

  const [row] = await db
    .update(facialReaders)
    .set({ isActive })
    .where(eq(facialReaders.id, readerId))
    .returning();

  return row;
}

/**
 * Resposta segura pós create/update/returning (sem segredo; com `hasCredentials`).
 */
export function readerRowToPublic(row: typeof facialReaders.$inferSelect) {
  const { passwordEncrypted, ...rest } = row;
  return {
    ...rest,
    brand: rest.brand ?? 'intelbras',
    direction: rest.direction ?? null,
    hasCredentials: !!(
      rest.username?.trim() &&
      passwordEncrypted != null &&
      String(passwordEncrypted).trim() !== ''
    ),
  };
}

/** Leitores ativos com credenciais — conexão snapManager. */
export type ReaderEventStreamRow = {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  companyId: string;
  brand: ReaderBrand;
  direction: ReaderDirection | null;
  ip: string;
  port: number;
  username: string;
  passwordEncrypted: string;
};

export async function listReadersForEventStream(
  db: AppDb,
): Promise<ReaderEventStreamRow[]> {
  const rows = await db
    .select({
      id: facialReaders.id,
      name: facialReaders.name,
      clientId: facialReaders.clientId,
      clientName: clients.name,
      companyId: clients.companyId,
      brand: facialReaders.brand,
      direction: facialReaders.direction,
      ip: facialReaders.ip,
      port: facialReaders.port,
      username: facialReaders.username,
      passwordEncrypted: facialReaders.passwordEncrypted,
    })
    .from(facialReaders)
    .innerJoin(clients, eq(facialReaders.clientId, clients.id))
    .where(
      and(
        eq(facialReaders.isActive, true),
        isNotNull(facialReaders.username),
        isNotNull(facialReaders.passwordEncrypted),
      ),
    )
    .orderBy(asc(clients.name), asc(facialReaders.name));

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
      brand: r.brand ?? 'intelbras',
      direction: r.direction ?? null,
      ip: r.ip,
      port: r.port,
      username: r.username as string,
      passwordEncrypted: r.passwordEncrypted as string,
    }));
}

export async function getReaderForEventStreamById(
  db: AppDb,
  readerId: string,
): Promise<ReaderEventStreamRow | undefined> {
  const [row] = await db
    .select({
      id: facialReaders.id,
      name: facialReaders.name,
      clientId: facialReaders.clientId,
      clientName: clients.name,
      companyId: clients.companyId,
      brand: facialReaders.brand,
      direction: facialReaders.direction,
      ip: facialReaders.ip,
      port: facialReaders.port,
      username: facialReaders.username,
      passwordEncrypted: facialReaders.passwordEncrypted,
    })
    .from(facialReaders)
    .innerJoin(clients, eq(facialReaders.clientId, clients.id))
    .where(
      and(
        eq(facialReaders.id, readerId),
        eq(facialReaders.isActive, true),
        isNotNull(facialReaders.username),
        isNotNull(facialReaders.passwordEncrypted),
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
    brand: row.brand ?? 'intelbras',
    direction: row.direction ?? null,
    ip: row.ip,
    port: row.port,
    username: row.username,
    passwordEncrypted: row.passwordEncrypted,
  };
}

export async function updateReaderLastSeenAt(
  db: AppDb,
  readerId: string,
  at: Date,
): Promise<void> {
  await db
    .update(facialReaders)
    .set({ lastSeenAt: at })
    .where(eq(facialReaders.id, readerId));
}

/** Dados para GET monitor/status (por empresa), sem segredos. */
export type ReaderMonitorListRow = {
  id: string;
  clientId: string;
  clientName: string;
  brand: ReaderBrand;
  name: string;
  ip: string;
  port: number;
  isActive: boolean;
  username: string | null;
  hasCredentials: boolean;
  lastSeenAt: Date | null;
  createdAt: Date;
};

export async function listReadersForMonitorReport(
  db: AppDb,
  companyId: string,
  filterClientId?: string,
): Promise<ReaderMonitorListRow[]> {
  const conditions = [eq(clients.companyId, companyId)];
  if (filterClientId) {
    conditions.push(eq(facialReaders.clientId, filterClientId));
  }

  const rows = await db
    .select({
      id: facialReaders.id,
      clientId: facialReaders.clientId,
      clientName: clients.name,
      brand: facialReaders.brand,
      name: facialReaders.name,
      ip: facialReaders.ip,
      port: facialReaders.port,
      isActive: facialReaders.isActive,
      username: facialReaders.username,
      passwordEncrypted: facialReaders.passwordEncrypted,
      lastSeenAt: facialReaders.lastSeenAt,
      createdAt: facialReaders.createdAt,
    })
    .from(facialReaders)
    .innerJoin(clients, eq(facialReaders.clientId, clients.id))
    .where(and(...conditions))
    .orderBy(asc(clients.name), asc(facialReaders.name));

  return rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    clientName: r.clientName,
    brand: r.brand ?? 'intelbras',
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

/** Leitores ativos com credencial — envio da face (digest HTTP). */
export type ReaderFaceSyncRow = {
  id: string;
  name: string;
  brand: ReaderBrand;
  ip: string;
  port: number;
  username: string;
  passwordEncrypted: string;
};

export async function listReadersForFaceSyncByClient(
  db: AppDb,
  clientId: string,
): Promise<ReaderFaceSyncRow[]> {
  const rows = await db
    .select({
      id: facialReaders.id,
      name: facialReaders.name,
      brand: facialReaders.brand,
      ip: facialReaders.ip,
      port: facialReaders.port,
      username: facialReaders.username,
      passwordEncrypted: facialReaders.passwordEncrypted,
    })
    .from(facialReaders)
    .where(
      and(
        eq(facialReaders.clientId, clientId),
        eq(facialReaders.isActive, true),
        isNotNull(facialReaders.username),
        isNotNull(facialReaders.passwordEncrypted),
      ),
    );

  return rows
    .filter(
      (r) => r.username?.trim() && r.passwordEncrypted?.trim() && r.ip?.trim(),
    )
    .map((r) => ({
      ...r,
      brand: r.brand ?? 'intelbras',
    })) as ReaderFaceSyncRow[];
}
