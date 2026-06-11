import {
  and,
  asc,
  count,
  eq,
  ilike,
  isNotNull,
  type SQL,
} from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { clientMembers, clientRoles, users } from '../schema';

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
  email: string | null;
};

export const SCHOOL_DEFAULT_ROLES = [
  { slug: 'funcionario', name: 'Funcionário' },
  { slug: 'professor', name: 'Professor' },
  { slug: 'coordenador', name: 'Coordenador' },
  { slug: 'diretor', name: 'Diretor' },
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
  return ilike(clientMembers.name, `%${term}%`);
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
      email: users.email,
    })
    .from(clientMembers)
    .innerJoin(clientRoles, eq(clientMembers.roleId, clientRoles.id))
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
      email: users.email,
    })
    .from(clientMembers)
    .innerJoin(clientRoles, eq(clientMembers.roleId, clientRoles.id))
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
