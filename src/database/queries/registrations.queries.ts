import {
  and,
  count,
  desc,
  eq,
  ilike,
  isNotNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import type { AppDb } from '../database.types';
import {
  clientFaceCounters,
  clients,
  registrationLinks,
  registrations,
} from '../schema';

import { incompleteDeviceSyncSql } from '../../face-sync/aggregate-reader-sync-outcome.util';
import { unaccentIlike } from './search-utils';

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

export type RegistrationStatus = 'draft' | 'approved' | 'rejected';

export type RegistrationStatusCounts = Record<RegistrationStatus, number>;

export type RegistrationListQueryOptions = {
  status?: RegistrationStatus;
  search?: string;
  offset?: number;
  limit?: number;
};

function registrationSearchCondition(search?: string): SQL | undefined {
  const term = search?.trim();
  if (!term) return undefined;
  const pattern = `%${term}%`;
  const digits = term.replace(/\D/g, '');
  const conds: SQL[] = [
    unaccentIlike(registrations.name, term),
    unaccentIlike(registrations.email, term),
    sql`coalesce(${registrations.additionalData}->>'block', '') ilike ${pattern}`,
    sql`coalesce(${registrations.additionalData}->>'unit', '') ilike ${pattern}`,
    sql`coalesce(${registrations.additionalData}->>'room', '') ilike ${pattern}`,
  ];
  if (digits.length >= 3) {
    conds.push(ilike(registrations.document, `%${digits}%`));
  }
  return or(...conds);
}

function submittedRegistrationsWhere(
  clientId: string,
  options: Pick<RegistrationListQueryOptions, 'status' | 'search'> = {},
) {
  const conds: SQL[] = [
    eq(registrations.clientId, clientId),
    isNotNull(registrations.submittedAt),
  ];
  if (options.status) {
    conds.push(eq(registrations.status, options.status));
  }
  const searchCond = registrationSearchCondition(options.search);
  if (searchCond) conds.push(searchCond);
  return and(...conds);
}

export async function countSubmittedRegistrationsForClient(
  db: AppDb,
  clientId: string,
  options: Pick<RegistrationListQueryOptions, 'status' | 'search'> = {},
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(registrations)
    .where(submittedRegistrationsWhere(clientId, options));
  return Number(row?.total ?? 0);
}

export async function countSubmittedRegistrationsByStatus(
  db: AppDb,
  clientId: string,
): Promise<RegistrationStatusCounts> {
  const rows = await db
    .select({
      status: registrations.status,
      total: count(),
    })
    .from(registrations)
    .where(
      and(
        eq(registrations.clientId, clientId),
        isNotNull(registrations.submittedAt),
      ),
    )
    .groupBy(registrations.status);

  const counts: RegistrationStatusCounts = {
    draft: 0,
    approved: 0,
    rejected: 0,
  };
  for (const row of rows) {
    if (row.status in counts) {
      counts[row.status] = Number(row.total);
    }
  }
  return counts;
}

export async function listSubmittedRegistrationsForClient(
  db: AppDb,
  clientId: string,
  options: RegistrationListQueryOptions = {},
): Promise<RegistrationRow[]> {
  const q = db
    .select()
    .from(registrations)
    .where(submittedRegistrationsWhere(clientId, options))
    .orderBy(desc(registrations.submittedAt));

  if (options.limit !== undefined) {
    q.limit(options.limit);
  }
  if (options.offset !== undefined) {
    q.offset(options.offset);
  }
  return q;
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

/** Aprovados com foto — pendentes por padrão; `includeSynced` inclui os já synced. */
export async function listApprovedRegistrationsForDeviceSync(
  db: AppDb,
  clientId: string,
  options?: { includeSynced?: boolean },
): Promise<RegistrationRow[]> {
  const conditions = [
    eq(registrations.clientId, clientId),
    eq(registrations.status, 'approved'),
    isNotNull(registrations.faceImageKey),
    isNotNull(registrations.faceId),
  ];
  if (!options?.includeSynced) {
    conditions.push(
      incompleteDeviceSyncSql(
        registrations.deviceSyncStatus,
        registrations.deviceSyncError,
      ),
    );
  }
  return db
    .select()
    .from(registrations)
    .where(and(...conditions))
    .orderBy(desc(registrations.submittedAt));
}

/** Aprovados com foto pendente, falha ou sync parcial. */
export async function listApprovedRegistrationsPendingDeviceSync(
  db: AppDb,
  clientId: string,
): Promise<RegistrationRow[]> {
  return listApprovedRegistrationsForDeviceSync(db, clientId);
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
