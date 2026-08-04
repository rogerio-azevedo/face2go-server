import {
  and,
  asc,
  count,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  type SQL,
} from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { clientMembers, clientRoles, clients, shifts, users } from '../schema';

import { unaccentIlike } from './search-utils';

export type MemberListQueryOptions = {
  search?: string;
  roleId?: string;
  offset?: number;
  limit?: number;
};

export type ClientRoleRow = typeof clientRoles.$inferSelect;
export type ClientMemberRow = typeof clientMembers.$inferSelect;

export type MemberWithRoleRow = ClientMemberRow & {
  roleName: string;
  roleSlug: string;
  shiftName: string | null;
  email: string | null;
};

export const SCHOOL_DEFAULT_ROLES = [
  { slug: 'funcionario', name: 'Funcionário' },
  { slug: 'professor', name: 'Professor' },
  { slug: 'coordenador', name: 'Coordenador' },
  { slug: 'diretor', name: 'Diretor' },
  { slug: 'estagiario', name: 'Estagiário' },
  { slug: 'terceirizado', name: 'Terceirizado' },
] as const;

export const CONDOMINIUM_DEFAULT_ROLES = [
  { slug: 'morador', name: 'Morador' },
  { slug: 'funcionario', name: 'Funcionário' },
] as const;

export const GENERIC_DEFAULT_ROLES = [
  { slug: 'autorizado', name: 'Autorizado' },
] as const;

function memberSearchCondition(search?: string): SQL | undefined {
  const term = search?.trim();
  if (!term) return undefined;
  const digits = term.replace(/\D/g, '');
  if (digits.length >= 3) {
    return or(
      unaccentIlike(clientMembers.name, term),
      ilike(clientMembers.document, `%${digits}%`),
    );
  }
  return unaccentIlike(clientMembers.name, term);
}

function memberClientWhere(
  clientId: string,
  options: Pick<MemberListQueryOptions, 'search' | 'roleId'> = {},
) {
  const conditions: SQL[] = [eq(clientMembers.clientId, clientId)];
  const nameCond = memberSearchCondition(options.search);
  if (nameCond) conditions.push(nameCond);
  if (options.roleId) {
    conditions.push(eq(clientMembers.roleId, options.roleId));
  }
  return and(...conditions);
}

export async function countMembersByClient(
  db: AppDb,
  clientId: string,
  options: Pick<MemberListQueryOptions, 'search' | 'roleId'> = {},
) {
  const [row] = await db
    .select({ total: count() })
    .from(clientMembers)
    .where(memberClientWhere(clientId, options));
  return Number(row?.total ?? 0);
}

export async function listMembersByClientWithRole(
  db: AppDb,
  clientId: string,
  options: MemberListQueryOptions = {},
): Promise<MemberWithRoleRow[]> {
  const q = db
    .select({
      member: clientMembers,
      roleName: clientRoles.name,
      roleSlug: clientRoles.slug,
      shiftName: shifts.name,
      email: users.email,
    })
    .from(clientMembers)
    .innerJoin(clientRoles, eq(clientMembers.roleId, clientRoles.id))
    .leftJoin(shifts, eq(clientMembers.shiftId, shifts.id))
    .leftJoin(users, eq(clientMembers.userId, users.id))
    .where(memberClientWhere(clientId, options))
    .orderBy(asc(clientMembers.name));

  if (options.limit !== undefined) q.limit(options.limit);
  if (options.offset !== undefined) q.offset(options.offset);

  const rows = await q;
  return rows.map((r) => ({
    ...r.member,
    roleName: r.roleName,
    roleSlug: r.roleSlug,
    shiftName: r.shiftName ?? null,
    email: r.email ?? r.member.email ?? null,
  }));
}

export async function listClientRoles(
  db: AppDb,
  clientId: string,
  activeOnly = true,
): Promise<ClientRoleRow[]> {
  const conditions = [eq(clientRoles.clientId, clientId)];
  if (activeOnly) {
    conditions.push(eq(clientRoles.isActive, true));
  }
  return db
    .select()
    .from(clientRoles)
    .where(and(...conditions))
    .orderBy(asc(clientRoles.name));
}

export async function getClientRoleById(
  db: AppDb,
  roleId: string,
  clientId: string,
) {
  const [row] = await db
    .select()
    .from(clientRoles)
    .where(and(eq(clientRoles.id, roleId), eq(clientRoles.clientId, clientId)))
    .limit(1);
  return row ?? null;
}

export async function getClientRoleBySlug(
  db: AppDb,
  clientId: string,
  slug: string,
) {
  const [row] = await db
    .select()
    .from(clientRoles)
    .where(and(eq(clientRoles.clientId, clientId), eq(clientRoles.slug, slug)))
    .limit(1);
  return row ?? null;
}

export async function insertClientRole(
  db: AppDb,
  input: {
    clientId: string;
    name: string;
    slug: string;
    isActive?: boolean;
  },
) {
  const [row] = await db
    .insert(clientRoles)
    .values({
      clientId: input.clientId,
      name: input.name,
      slug: input.slug,
      isActive: input.isActive ?? true,
      updatedAt: new Date(),
    })
    .returning();
  return row;
}

export async function updateClientRole(
  db: AppDb,
  roleId: string,
  clientId: string,
  patch: Partial<Pick<ClientRoleRow, 'name' | 'slug' | 'isActive'>>,
) {
  const [row] = await db
    .update(clientRoles)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(clientRoles.id, roleId), eq(clientRoles.clientId, clientId)))
    .returning();
  return row ?? null;
}

export async function seedDefaultRolesForClient(
  db: AppDb,
  clientId: string,
  clientType: string,
): Promise<ClientRoleRow[]> {
  const existing = await listClientRoles(db, clientId, false);
  if (existing.length > 0) {
    return existing;
  }

  let defaults: ReadonlyArray<{ slug: string; name: string }>;
  if (clientType === 'school') {
    defaults = SCHOOL_DEFAULT_ROLES;
  } else if (clientType === 'condominium') {
    defaults = CONDOMINIUM_DEFAULT_ROLES;
  } else {
    defaults = GENERIC_DEFAULT_ROLES;
  }

  const created: ClientRoleRow[] = [];
  for (const role of defaults) {
    const row = await insertClientRole(db, {
      clientId,
      name: role.name,
      slug: role.slug,
    });
    created.push(row);
  }
  return created;
}

export async function getMemberById(
  db: AppDb,
  memberId: string,
  clientId: string,
) {
  const [row] = await db
    .select()
    .from(clientMembers)
    .where(
      and(eq(clientMembers.id, memberId), eq(clientMembers.clientId, clientId)),
    )
    .limit(1);
  return row ?? null;
}

export async function getMemberWithRoleById(
  db: AppDb,
  memberId: string,
  clientId: string,
): Promise<MemberWithRoleRow | null> {
  const [row] = await db
    .select({
      member: clientMembers,
      roleName: clientRoles.name,
      roleSlug: clientRoles.slug,
      shiftName: shifts.name,
      email: users.email,
    })
    .from(clientMembers)
    .innerJoin(clientRoles, eq(clientMembers.roleId, clientRoles.id))
    .leftJoin(shifts, eq(clientMembers.shiftId, shifts.id))
    .leftJoin(users, eq(clientMembers.userId, users.id))
    .where(
      and(eq(clientMembers.id, memberId), eq(clientMembers.clientId, clientId)),
    )
    .limit(1);

  if (!row) return null;
  return {
    ...row.member,
    roleName: row.roleName,
    roleSlug: row.roleSlug,
    shiftName: row.shiftName ?? null,
    email: row.email ?? row.member.email ?? null,
  };
}

export async function getMemberWithFaceStatus(
  db: AppDb,
  memberId: string,
  clientId: string,
) {
  return getMemberById(db, memberId, clientId);
}

export async function getMemberByUserIdAndClient(
  db: AppDb,
  userId: string,
  clientId: string,
) {
  const [row] = await db
    .select()
    .from(clientMembers)
    .where(
      and(
        eq(clientMembers.userId, userId),
        eq(clientMembers.clientId, clientId),
        eq(clientMembers.isActive, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getMemberByRegistrationId(
  db: AppDb,
  registrationId: string,
) {
  const [row] = await db
    .select()
    .from(clientMembers)
    .where(eq(clientMembers.registrationId, registrationId))
    .limit(1);
  return row ?? null;
}

export async function insertMember(
  db: AppDb,
  input: {
    clientId: string;
    roleId: string;
    shiftId?: string | null;
    userId?: string | null;
    registrationId?: string | null;
    name: string;
    email?: string | null;
    phone?: string | null;
    document?: string | null;
    birthDate?: string | null;
    photoKey?: string | null;
    faceId?: number | null;
    deviceSyncStatus?: ClientMemberRow['deviceSyncStatus'];
    deviceSyncedAt?: Date | null;
    deviceSyncError?: string | null;
    additionalData?: ClientMemberRow['additionalData'];
    isActive?: boolean;
  },
) {
  const [row] = await db
    .insert(clientMembers)
    .values({
      clientId: input.clientId,
      roleId: input.roleId,
      shiftId: input.shiftId ?? null,
      userId: input.userId ?? null,
      registrationId: input.registrationId ?? null,
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      document: input.document ?? null,
      birthDate: input.birthDate ?? null,
      photoKey: input.photoKey ?? null,
      faceId: input.faceId ?? null,
      deviceSyncStatus: input.deviceSyncStatus ?? null,
      deviceSyncedAt: input.deviceSyncedAt ?? null,
      deviceSyncError: input.deviceSyncError ?? null,
      additionalData: input.additionalData ?? null,
      isActive: input.isActive ?? true,
      updatedAt: new Date(),
    })
    .returning();
  return row;
}

export async function updateMember(
  db: AppDb,
  memberId: string,
  clientId: string,
  patch: Partial<
    Pick<
      ClientMemberRow,
      | 'roleId'
      | 'shiftId'
      | 'name'
      | 'email'
      | 'phone'
      | 'document'
      | 'birthDate'
      | 'photoKey'
      | 'faceId'
      | 'deviceSyncStatus'
      | 'deviceSyncedAt'
      | 'deviceSyncError'
      | 'additionalData'
      | 'isActive'
      | 'canEnrollStudentFace'
      | 'userId'
    >
  >,
) {
  const [row] = await db
    .update(clientMembers)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(eq(clientMembers.id, memberId), eq(clientMembers.clientId, clientId)),
    )
    .returning();
  return row ?? null;
}

export async function linkUserToMember(
  db: AppDb,
  memberId: string,
  clientId: string,
  userId: string,
) {
  return updateMember(db, memberId, clientId, { userId });
}

export async function updateMemberFace(
  db: AppDb,
  memberId: string,
  clientId: string,
  patch: Partial<
    Pick<
      ClientMemberRow,
      | 'photoKey'
      | 'faceId'
      | 'deviceSyncStatus'
      | 'deviceSyncedAt'
      | 'deviceSyncError'
    >
  >,
) {
  return updateMember(db, memberId, clientId, patch);
}

export async function deleteMember(
  db: AppDb,
  memberId: string,
  clientId: string,
) {
  const [row] = await db
    .delete(clientMembers)
    .where(
      and(eq(clientMembers.id, memberId), eq(clientMembers.clientId, clientId)),
    )
    .returning({ id: clientMembers.id });
  return row ?? null;
}

export async function findMemberByFaceIdAndClientId(
  db: AppDb,
  faceId: number,
  clientId: string,
) {
  const [row] = await db
    .select({
      id: clientMembers.id,
      name: clientMembers.name,
      photoKey: clientMembers.photoKey,
      roleSlug: clientRoles.slug,
      roleName: clientRoles.name,
    })
    .from(clientMembers)
    .innerJoin(clientRoles, eq(clientMembers.roleId, clientRoles.id))
    .where(
      and(
        eq(clientMembers.clientId, clientId),
        eq(clientMembers.faceId, faceId),
        eq(clientMembers.isActive, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function findMemberNameByFaceId(
  db: AppDb,
  clientId: string,
  faceId: number,
): Promise<string | null> {
  const row = await findMemberByFaceIdAndClientId(db, faceId, clientId);
  return row?.name ?? null;
}

export async function listMembersWithPhotoByClient(
  db: AppDb,
  clientId: string,
) {
  return db
    .select()
    .from(clientMembers)
    .where(
      and(
        eq(clientMembers.clientId, clientId),
        eq(clientMembers.isActive, true),
        isNotNull(clientMembers.photoKey),
      ),
    )
    .orderBy(asc(clientMembers.name));
}

export async function getMemberEmailByUserId(
  db: AppDb,
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.email ?? null;
}

export async function getMemberPushToken(
  db: AppDb,
  memberId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ pushToken: clientMembers.pushToken })
    .from(clientMembers)
    .where(eq(clientMembers.id, memberId))
    .limit(1);
  return row?.pushToken ?? null;
}

export async function updateMemberPushTokenById(
  db: AppDb,
  memberId: string,
  pushToken: string,
) {
  const [row] = await db
    .update(clientMembers)
    .set({ pushToken, updatedAt: new Date() })
    .where(eq(clientMembers.id, memberId))
    .returning({ id: clientMembers.id });
  return row;
}

export type MemberWithPushTokenRow = {
  memberId: string;
  userId: string | null;
  pushToken: string;
  name: string;
};

export async function listMembersWithPushTokenByClient(
  db: AppDb,
  clientId: string,
  excludeUserId?: string | null,
): Promise<MemberWithPushTokenRow[]> {
  const conditions: SQL[] = [
    eq(clientMembers.clientId, clientId),
    eq(clientMembers.isActive, true),
    isNotNull(clientMembers.pushToken),
    ne(clientMembers.pushToken, ''),
  ];

  if (excludeUserId) {
    conditions.push(
      or(
        isNull(clientMembers.userId),
        ne(clientMembers.userId, excludeUserId),
      )!,
    );
  }

  const rows = await db
    .select({
      memberId: clientMembers.id,
      userId: clientMembers.userId,
      pushToken: clientMembers.pushToken,
      name: clientMembers.name,
    })
    .from(clientMembers)
    .where(and(...conditions));

  return rows
    .filter(
      (row): row is typeof row & { pushToken: string } =>
        typeof row.pushToken === 'string' && row.pushToken.length > 0,
    )
    .map((row) => ({
      memberId: row.memberId,
      userId: row.userId,
      pushToken: row.pushToken,
      name: row.name,
    }));
}

export type MemberProfileContextRow = {
  id: string;
  clientId: string;
  clientName: string;
  userId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  document: string | null;
  isActive: boolean;
};

/** Apenas clientes escola — app e cadastro unificado são exclusivos desse domínio. */
const schoolClientType = eq(clients.type, 'school');

export async function findMembersByDocumentGlobally(
  db: AppDb,
  document: string,
): Promise<MemberProfileContextRow[]> {
  const normalized = document.replace(/\D/g, '');
  if (normalized.length !== 11) return [];
  return db
    .select({
      id: clientMembers.id,
      clientId: clientMembers.clientId,
      clientName: clients.name,
      userId: clientMembers.userId,
      name: clientMembers.name,
      email: clientMembers.email,
      phone: clientMembers.phone,
      document: clientMembers.document,
      isActive: clientMembers.isActive,
    })
    .from(clientMembers)
    .innerJoin(clients, eq(clientMembers.clientId, clients.id))
    .where(and(eq(clientMembers.document, normalized), schoolClientType))
    .orderBy(asc(clients.name), asc(clientMembers.name));
}

export async function findMembersByEmailGlobally(
  db: AppDb,
  email: string,
): Promise<MemberProfileContextRow[]> {
  const normalized = email.trim().toLowerCase();
  return db
    .select({
      id: clientMembers.id,
      clientId: clientMembers.clientId,
      clientName: clients.name,
      userId: clientMembers.userId,
      name: clientMembers.name,
      email: clientMembers.email,
      phone: clientMembers.phone,
      document: clientMembers.document,
      isActive: clientMembers.isActive,
    })
    .from(clientMembers)
    .innerJoin(clients, eq(clientMembers.clientId, clients.id))
    .where(and(eq(clientMembers.email, normalized), schoolClientType))
    .orderBy(asc(clients.name), asc(clientMembers.name));
}

export async function listMemberContextsByUserId(
  db: AppDb,
  userId: string,
): Promise<MemberProfileContextRow[]> {
  return db
    .select({
      id: clientMembers.id,
      clientId: clientMembers.clientId,
      clientName: clients.name,
      userId: clientMembers.userId,
      name: clientMembers.name,
      email: clientMembers.email,
      phone: clientMembers.phone,
      document: clientMembers.document,
      isActive: clientMembers.isActive,
    })
    .from(clientMembers)
    .innerJoin(clients, eq(clientMembers.clientId, clients.id))
    .where(and(eq(clientMembers.userId, userId), schoolClientType))
    .orderBy(asc(clients.name), asc(clientMembers.name));
}

export async function linkLegacyMembersByDocument(
  db: AppDb,
  document: string,
  userId: string,
) {
  const normalized = document.replace(/\D/g, '');
  if (normalized.length !== 11) return;

  const targets = await db
    .select({ id: clientMembers.id })
    .from(clientMembers)
    .innerJoin(clients, eq(clientMembers.clientId, clients.id))
    .where(
      and(
        eq(clientMembers.document, normalized),
        isNull(clientMembers.userId),
        schoolClientType,
      ),
    );

  if (targets.length === 0) return;

  await db
    .update(clientMembers)
    .set({ userId, updatedAt: new Date() })
    .where(
      inArray(
        clientMembers.id,
        targets.map((row) => row.id),
      ),
    );
}

/** Remove login de membros em clientes que não são escola (correção de vínculo indevido). */
export async function unlinkNonSchoolMemberLogins(db: AppDb) {
  const rows = await db
    .select({ id: clientMembers.id })
    .from(clientMembers)
    .innerJoin(clients, eq(clientMembers.clientId, clients.id))
    .where(and(isNotNull(clientMembers.userId), ne(clients.type, 'school')));

  if (rows.length === 0) return 0;

  await db
    .update(clientMembers)
    .set({ userId: null, updatedAt: new Date() })
    .where(
      inArray(
        clientMembers.id,
        rows.map((row) => row.id),
      ),
    );

  return rows.length;
}
