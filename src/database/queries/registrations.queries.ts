import { and, desc, eq, isNotNull, or, sql } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import {
  clientFaceCounters,
  clients,
  registrationLinks,
  registrations,
} from '../schema';

export type RegistrationLinkRow = typeof registrationLinks.$inferSelect;
export type RegistrationRow = typeof registrations.$inferSelect;

export async function insertRegistrationLink(
  db: AppDb,
  input: {
    clientId: string;
    createdByUserId: string;
    code: string;
    validFrom?: Date | null;
    expiresAt?: Date | null;
  },
): Promise<RegistrationLinkRow> {
  const now = new Date();
  const [row] = await db
    .insert(registrationLinks)
    .values({
      clientId: input.clientId,
      createdByUserId: input.createdByUserId,
      code: input.code,
      validFrom: input.validFrom ?? null,
      expiresAt: input.expiresAt ?? null,
      updatedAt: now,
    })
    .returning();
  return row;
}

export async function listRegistrationLinksByClient(
  db: AppDb,
  clientId: string,
): Promise<RegistrationLinkRow[]> {
  return db
    .select()
    .from(registrationLinks)
    .where(eq(registrationLinks.clientId, clientId))
    .orderBy(desc(registrationLinks.createdAt));
}

export async function getRegistrationLinkByIdForClient(
  db: AppDb,
  linkId: string,
  clientId: string,
): Promise<RegistrationLinkRow | undefined> {
  const [row] = await db
    .select()
    .from(registrationLinks)
    .where(
      and(
        eq(registrationLinks.id, linkId),
        eq(registrationLinks.clientId, clientId),
      ),
    )
    .limit(1);
  return row;
}

export async function setRegistrationLinkActive(
  db: AppDb,
  linkId: string,
  clientId: string,
  isActive: boolean,
): Promise<RegistrationLinkRow | undefined> {
  const now = new Date();
  const [row] = await db
    .update(registrationLinks)
    .set({ isActive, updatedAt: now })
    .where(
      and(
        eq(registrationLinks.id, linkId),
        eq(registrationLinks.clientId, clientId),
      ),
    )
    .returning();
  return row;
}

export type RegistrationLinkWithClient = {
  link: RegistrationLinkRow;
  client: typeof clients.$inferSelect;
};

export async function getActiveRegistrationLinkWithClient(
  db: AppDb,
  codeRaw: string,
): Promise<RegistrationLinkWithClient | undefined> {
  const code = codeRaw.trim().toUpperCase();
  const [row] = await db
    .select({
      link: registrationLinks,
      client: clients,
    })
    .from(registrationLinks)
    .innerJoin(clients, eq(registrationLinks.clientId, clients.id))
    .where(eq(registrationLinks.code, code))
    .limit(1);
  return row;
}

export async function insertRegistration(
  db: AppDb,
  input: {
    id: string;
    registrationLinkId: string;
    clientId: string;
    name: string;
    document: string;
    phone: string;
    email: string;
    faceImageKey: string;
    additionalData: Record<string, unknown> | null;
  },
): Promise<RegistrationRow> {
  const now = new Date();
  const [row] = await db
    .insert(registrations)
    .values({
      id: input.id,
      registrationLinkId: input.registrationLinkId,
      clientId: input.clientId,
      name: input.name,
      document: input.document,
      phone: input.phone,
      email: input.email,
      faceImageKey: input.faceImageKey,
      additionalData: input.additionalData,
      status: 'draft',
      submittedAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
}

export async function getRegistrationByIdForClient(
  db: AppDb,
  registrationId: string,
  clientId: string,
): Promise<RegistrationRow | undefined> {
  const [row] = await db
    .select()
    .from(registrations)
    .where(
      and(
        eq(registrations.id, registrationId),
        eq(registrations.clientId, clientId),
      ),
    )
    .limit(1);
  return row;
}

export async function listSubmittedRegistrationsForClient(
  db: AppDb,
  clientId: string,
  status?: 'draft' | 'approved' | 'rejected',
): Promise<RegistrationRow[]> {
  const conds = [
    eq(registrations.clientId, clientId),
    isNotNull(registrations.submittedAt),
  ];
  if (status) {
    conds.push(eq(registrations.status, status));
  }
  return db
    .select()
    .from(registrations)
    .where(and(...conds))
    .orderBy(desc(registrations.submittedAt));
}

export async function approveRegistration(
  db: AppDb,
  registrationId: string,
  clientId: string,
  approvedByUserId: string,
): Promise<RegistrationRow | undefined> {
  const now = new Date();
  const [row] = await db
    .update(registrations)
    .set({
      status: 'approved',
      approvedByUserId,
      approvedAt: now,
      rejectionNotes: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(registrations.id, registrationId),
        eq(registrations.clientId, clientId),
        eq(registrations.status, 'draft'),
        isNotNull(registrations.submittedAt),
      ),
    )
    .returning();
  return row;
}

export async function rejectRegistration(
  db: AppDb,
  registrationId: string,
  clientId: string,
  approvedByUserId: string,
  notes: string | null,
): Promise<RegistrationRow | undefined> {
  const now = new Date();
  const [row] = await db
    .update(registrations)
    .set({
      status: 'rejected',
      approvedByUserId,
      approvedAt: now,
      rejectionNotes: notes,
      updatedAt: now,
    })
    .where(
      and(
        eq(registrations.id, registrationId),
        eq(registrations.clientId, clientId),
        eq(registrations.status, 'draft'),
        isNotNull(registrations.submittedAt),
      ),
    )
    .returning();
  return row;
}

/** Incrementa e retorna o próximo face_id por cliente (1, 2, …). Atômico no Postgres. */
export async function bumpClientFaceCounter(
  db: AppDb,
  clientId: string,
): Promise<number> {
  const [row] = await db
    .insert(clientFaceCounters)
    .values({ clientId, lastFaceId: 1 })
    .onConflictDoUpdate({
      target: clientFaceCounters.clientId,
      set: {
        lastFaceId: sql`client_face_counters.last_face_id + 1`,
      },
    })
    .returning({ lastFaceId: clientFaceCounters.lastFaceId });

  if (!row) {
    throw new Error('Contador face_id falhou.');
  }
  return row.lastFaceId;
}

export async function setRegistrationFaceAfterApprove(
  db: AppDb,
  registrationId: string,
  clientId: string,
  faceId: number,
): Promise<RegistrationRow | undefined> {
  const now = new Date();
  const [row] = await db
    .update(registrations)
    .set({
      faceId,
      deviceSyncStatus: 'pending_sync',
      deviceSyncedAt: null,
      deviceSyncError: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(registrations.id, registrationId),
        eq(registrations.clientId, clientId),
        eq(registrations.status, 'approved'),
      ),
    )
    .returning();
  return row;
}

export async function updateRegistrationDeviceSync(
  db: AppDb,
  registrationId: string,
  clientId: string,
  input: {
    deviceSyncStatus: 'pending_sync' | 'synced' | 'sync_failed';
    deviceSyncedAt?: Date | null;
    deviceSyncError?: string | null;
  },
): Promise<RegistrationRow | undefined> {
  const now = new Date();
  const patch: Partial<typeof registrations.$inferInsert> = {
    deviceSyncStatus: input.deviceSyncStatus,
    updatedAt: now,
  };
  if ('deviceSyncedAt' in input) {
    patch.deviceSyncedAt = input.deviceSyncedAt ?? null;
  }
  if ('deviceSyncError' in input) {
    patch.deviceSyncError = input.deviceSyncError ?? null;
  }
  const [row] = await db
    .update(registrations)
    .set(patch)
    .where(
      and(
        eq(registrations.id, registrationId),
        eq(registrations.clientId, clientId),
      ),
    )
    .returning();
  return row;
}

/** Aprovados com foto que ainda falta sync com leitor ou re-sync após erro. */
export async function listApprovedRegistrationsPendingDeviceSync(
  db: AppDb,
  clientId: string,
): Promise<RegistrationRow[]> {
  return db
    .select()
    .from(registrations)
    .where(
      and(
        eq(registrations.clientId, clientId),
        eq(registrations.status, 'approved'),
        isNotNull(registrations.faceImageKey),
        isNotNull(registrations.faceId),
        or(
          eq(registrations.deviceSyncStatus, 'pending_sync'),
          eq(registrations.deviceSyncStatus, 'sync_failed'),
        ),
      ),
    )
    .orderBy(desc(registrations.submittedAt));
}

/** Clientes com cadastros aprovados presos em pending_sync (reconciliação pós-restart). */
export async function listClientIdsWithPendingDeviceSync(
  db: AppDb,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ clientId: registrations.clientId })
    .from(registrations)
    .where(
      and(
        eq(registrations.status, 'approved'),
        eq(registrations.deviceSyncStatus, 'pending_sync'),
        isNotNull(registrations.faceImageKey),
        isNotNull(registrations.faceId),
      ),
    );
  return rows.map((r) => r.clientId);
}

/** Nome do cadastro aprovado associado ao face_id do leitor (por cliente). */
export async function findApprovedRegistrationNameByFaceId(
  db: AppDb,
  clientId: string,
  faceId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ name: registrations.name })
    .from(registrations)
    .where(
      and(
        eq(registrations.clientId, clientId),
        eq(registrations.faceId, faceId),
        eq(registrations.status, 'approved'),
      ),
    )
    .limit(1);
  const n = row?.name?.trim();
  return n || null;
}
