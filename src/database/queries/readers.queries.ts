import { and, asc, eq } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import * as clientsQueries from './clients.queries';
import { clients, facialReaders } from '../schema';

export type ReaderBrand = 'intelbras' | 'hikvision';

export type ReaderListRow = {
  id: string;
  clientId: string;
  clientName: string;
  brand: ReaderBrand;
  name: string;
  description: string | null;
  ip: string;
  port: number;
  serialNumber: string | null;
  model: string | null;
  location: string | null;
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
      name: facialReaders.name,
      description: facialReaders.description,
      ip: facialReaders.ip,
      port: facialReaders.port,
      serialNumber: facialReaders.serialNumber,
      model: facialReaders.model,
      location: facialReaders.location,
      isActive: facialReaders.isActive,
      lastSeenAt: facialReaders.lastSeenAt,
      createdAt: facialReaders.createdAt,
    })
    .from(facialReaders)
    .innerJoin(clients, eq(facialReaders.clientId, clients.id))
    .where(and(...conditions))
    .orderBy(asc(clients.name), asc(facialReaders.name));

  return rows.map((r) => ({
    ...r,
    brand: (r.brand ?? 'intelbras') as ReaderBrand,
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
      name: facialReaders.name,
      description: facialReaders.description,
      ip: facialReaders.ip,
      port: facialReaders.port,
      serialNumber: facialReaders.serialNumber,
      model: facialReaders.model,
      location: facialReaders.location,
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

  return {
    ...row,
    brand: (row.brand ?? 'intelbras') as ReaderBrand,
  };
}

export type ReaderCreateInput = {
  companyId: string;
  clientId: string;
  brand: ReaderBrand;
  name: string;
  description?: string | null;
  ip: string;
  port: number;
  serialNumber?: string | null;
  model?: string | null;
  location?: string | null;
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
      name: input.name.trim(),
      description: input.description?.trim() || null,
      ip: input.ip.trim(),
      port: input.port,
      serialNumber: input.serialNumber?.trim() || null,
      model: input.model?.trim() || null,
      location: input.location?.trim() || null,
      isActive: input.isActive ?? true,
    })
    .returning();

  return row;
}

export type ReaderUpdateInput = Partial<{
  clientId: string;
  brand: ReaderBrand;
  name: string;
  description: string | null;
  ip: string;
  port: number;
  serialNumber: string | null;
  model: string | null;
  location: string | null;
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
      input.model === null || input.model === ''
        ? null
        : input.model.trim();
  }
  if (input.location !== undefined) {
    setPayload.location =
      input.location === null || input.location === ''
        ? null
        : input.location.trim();
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
