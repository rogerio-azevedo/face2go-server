import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
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
import { normalizedDocumentEquals } from './document-match';
import { unaccentIlike } from './search-utils';

export type RegistrationLinkRow = typeof registrationLinks.$inferSelect;
export type RegistrationRow = typeof registrations.$inferSelect;

export type RegistrationListRow = RegistrationRow & {
  registrationLinkCode: string | null;
};

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
    .where(
      and(
        eq(registrationLinks.clientId, clientId),
        isNull(registrationLinks.deletedAt),
      ),
    )
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
        isNull(registrationLinks.deletedAt),
      ),
    )
    .returning();
  return row;
}

export async function softDeleteRegistrationLink(
  db: AppDb,
  linkId: string,
  clientId: string,
): Promise<RegistrationLinkRow | undefined> {
  const now = new Date();
  const [row] = await db
    .update(registrationLinks)
    .set({ deletedAt: now, isActive: false, updatedAt: now })
    .where(
      and(
        eq(registrationLinks.id, linkId),
        eq(registrationLinks.clientId, clientId),
        isNull(registrationLinks.deletedAt),
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
    document: string | null;
    phone: string | null;
    email: string | null;
    birthDate: string | null;
    faceImageKey: string;
    additionalData: RegistrationRow['additionalData'];
    truthDeclaredAt: Date;
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
      birthDate: input.birthDate,
      faceImageKey: input.faceImageKey,
      additionalData: input.additionalData,
      status: 'draft',
      submittedAt: now,
      truthDeclaredAt: input.truthDeclaredAt,
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

export type RegistrationStatus = 'draft' | 'approved' | 'rejected' | 'blocked';

export type RegistrationListFilter = RegistrationStatus | 'deleted';

export type RegistrationStatusCounts = Record<
  RegistrationStatus | 'deleted',
  number
>;

export type RegistrationListQueryOptions = {
  status?: RegistrationListFilter;
  search?: string;
  block?: string;
  unit?: string;
  room?: string;
  offset?: number;
  limit?: number;
};

type RegistrationListFilterOptions = Pick<
  RegistrationListQueryOptions,
  'status' | 'search' | 'block' | 'unit' | 'room'
>;

function registrationSearchCondition(search?: string): SQL | undefined {
  const term = search?.trim();
  if (!term) return undefined;
  const digits = term.replace(/\D/g, '');
  const conds: SQL[] = [
    unaccentIlike(registrations.name, term),
    unaccentIlike(registrations.email, term),
  ];
  if (digits.length >= 3) {
    conds.push(ilike(registrations.document, `%${digits}%`));
  }
  return or(...conds);
}

function additionalDataFieldEquals(
  key: 'block' | 'unit' | 'room',
  value?: string,
): SQL | undefined {
  const term = value?.trim();
  if (!term) return undefined;
  if (key === 'block') {
    return sql`coalesce(${registrations.additionalData}->>'block', '') ilike ${term}`;
  }
  if (key === 'unit') {
    return sql`coalesce(${registrations.additionalData}->>'unit', '') ilike ${term}`;
  }
  return sql`coalesce(${registrations.additionalData}->>'room', '') ilike ${term}`;
}

function submittedRegistrationsWhere(
  clientId: string,
  options: RegistrationListFilterOptions = {},
) {
  const conds: SQL[] = [
    eq(registrations.clientId, clientId),
    isNotNull(registrations.submittedAt),
  ];
  if (options.status === 'deleted') {
    conds.push(eq(registrations.isActive, false));
  } else {
    conds.push(eq(registrations.isActive, true));
    if (options.status) {
      conds.push(eq(registrations.status, options.status));
    }
  }
  const searchCond = registrationSearchCondition(options.search);
  if (searchCond) conds.push(searchCond);
  const blockCond = additionalDataFieldEquals('block', options.block);
  if (blockCond) conds.push(blockCond);
  const unitCond = additionalDataFieldEquals('unit', options.unit);
  if (unitCond) conds.push(unitCond);
  const roomCond = additionalDataFieldEquals('room', options.room);
  if (roomCond) conds.push(roomCond);
  return and(...conds);
}

export async function countSubmittedRegistrationsForClient(
  db: AppDb,
  clientId: string,
  options: RegistrationListFilterOptions = {},
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
      isActive: registrations.isActive,
      total: count(),
    })
    .from(registrations)
    .where(
      and(
        eq(registrations.clientId, clientId),
        isNotNull(registrations.submittedAt),
      ),
    )
    .groupBy(registrations.status, registrations.isActive);

  const counts: RegistrationStatusCounts = {
    draft: 0,
    approved: 0,
    rejected: 0,
    blocked: 0,
    deleted: 0,
  };
  for (const row of rows) {
    if (!row.isActive) {
      counts.deleted += Number(row.total);
      continue;
    }
    if (
      row.status === 'draft' ||
      row.status === 'approved' ||
      row.status === 'rejected' ||
      row.status === 'blocked'
    ) {
      counts[row.status] = Number(row.total);
    }
  }
  return counts;
}

export async function listSubmittedRegistrationsForClient(
  db: AppDb,
  clientId: string,
  options: RegistrationListQueryOptions = {},
): Promise<RegistrationListRow[]> {
  const q = db
    .select({
      registration: registrations,
      registrationLinkCode: registrationLinks.code,
    })
    .from(registrations)
    .innerJoin(
      registrationLinks,
      eq(registrations.registrationLinkId, registrationLinks.id),
    )
    .where(submittedRegistrationsWhere(clientId, options))
    .orderBy(desc(registrations.submittedAt));

  if (options.limit !== undefined) {
    q.limit(options.limit);
  }
  if (options.offset !== undefined) {
    q.offset(options.offset);
  }
  const rows = await q;
  return rows.map((r) => ({
    ...r.registration,
    registrationLinkCode: r.registrationLinkCode,
  }));
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

export async function blockRegistration(
  db: AppDb,
  registrationId: string,
  clientId: string,
  blockedByUserId: string,
  reason: string,
): Promise<RegistrationRow | undefined> {
  const now = new Date();
  const [row] = await db
    .update(registrations)
    .set({
      status: 'blocked',
      blockReason: reason,
      blockedAt: now,
      blockedByUserId,
      updatedAt: now,
    })
    .where(
      and(
        eq(registrations.id, registrationId),
        eq(registrations.clientId, clientId),
        inArray(registrations.status, ['draft', 'approved']),
        isNotNull(registrations.submittedAt),
        eq(registrations.isActive, true),
      ),
    )
    .returning();
  return row;
}

export async function unblockRegistration(
  db: AppDb,
  registrationId: string,
  clientId: string,
): Promise<RegistrationRow | undefined> {
  const now = new Date();
  const [row] = await db
    .update(registrations)
    .set({
      status: 'approved',
      blockReason: null,
      blockedAt: null,
      blockedByUserId: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(registrations.id, registrationId),
        eq(registrations.clientId, clientId),
        eq(registrations.status, 'blocked'),
        isNotNull(registrations.submittedAt),
        eq(registrations.isActive, true),
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
        inArray(registrations.status, ['approved', 'blocked']),
      ),
    )
    .returning();
  return row;
}

export async function updateRegistrationProfile(
  db: AppDb,
  registrationId: string,
  clientId: string,
  patch: {
    name: string;
    document: string | null;
    phone: string | null;
    email: string | null;
    birthDate: string | null;
    additionalData: RegistrationRow['additionalData'];
  },
): Promise<RegistrationRow | undefined> {
  const now = new Date();
  const [row] = await db
    .update(registrations)
    .set({
      name: patch.name,
      document: patch.document,
      phone: patch.phone,
      email: patch.email,
      birthDate: patch.birthDate,
      additionalData: patch.additionalData,
      updatedAt: now,
    })
    .where(
      and(
        eq(registrations.id, registrationId),
        eq(registrations.clientId, clientId),
      ),
    )
    .returning();
  return row;
}

export async function setRegistrationActive(
  db: AppDb,
  registrationId: string,
  clientId: string,
  isActive: boolean,
): Promise<RegistrationRow | undefined> {
  const now = new Date();
  const [row] = await db
    .update(registrations)
    .set({ isActive, updatedAt: now })
    .where(
      and(
        eq(registrations.id, registrationId),
        eq(registrations.clientId, clientId),
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
    eq(registrations.isActive, true),
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
        eq(registrations.isActive, true),
        eq(registrations.deviceSyncStatus, 'pending_sync'),
        isNotNull(registrations.faceImageKey),
        isNotNull(registrations.faceId),
      ),
    );
  return rows.map((r) => r.clientId);
}

export async function findPendingRegistrationByNormalizedDocument(
  db: AppDb,
  clientId: string,
  document: string,
  excludeRegistrationId?: string,
): Promise<RegistrationRow | null> {
  const digits = document.replace(/\D/g, '');
  if (!digits) return null;

  const conditions: SQL[] = [
    eq(registrations.clientId, clientId),
    eq(registrations.status, 'draft'),
    isNotNull(registrations.submittedAt),
    normalizedDocumentEquals(registrations.document, digits),
  ];
  if (excludeRegistrationId) {
    conditions.push(ne(registrations.id, excludeRegistrationId));
  }

  const [row] = await db
    .select()
    .from(registrations)
    .where(and(...conditions))
    .limit(1);
  return row ?? null;
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
