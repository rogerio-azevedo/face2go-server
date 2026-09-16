import { and, asc, eq, ne } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { clientUsers, companyUsers, users } from '../schema';

export type ClientUserListRow = {
  clientUserId: string;
  userId: string;
  email: string;
  name: string | null;
  role: 'client_admin' | 'client_operator';
  isActive: boolean;
  createdAt: Date;
};

export async function listClientUsers(
  db: AppDb,
  clientId: string,
): Promise<ClientUserListRow[]> {
  return db
    .select({
      clientUserId: clientUsers.id,
      userId: users.id,
      email: users.email,
      name: users.name,
      role: clientUsers.role,
      isActive: clientUsers.isActive,
      createdAt: clientUsers.createdAt,
    })
    .from(clientUsers)
    .innerJoin(users, eq(clientUsers.userId, users.id))
    .where(eq(clientUsers.clientId, clientId))
    .orderBy(asc(users.name));
}

export type ClientAdminEmailRow = {
  userId: string;
  email: string;
  name: string | null;
};

export async function listActiveClientAdminEmails(
  db: AppDb,
  clientId: string,
): Promise<ClientAdminEmailRow[]> {
  return db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
    })
    .from(clientUsers)
    .innerJoin(users, eq(clientUsers.userId, users.id))
    .where(
      and(
        eq(clientUsers.clientId, clientId),
        eq(clientUsers.role, 'client_admin'),
        eq(clientUsers.isActive, true),
        eq(users.isActive, true),
      ),
    )
    .orderBy(asc(users.name));
}

export async function getClientUserLink(
  db: AppDb,
  userId: string,
  clientId: string,
) {
  const [row] = await db
    .select()
    .from(clientUsers)
    .where(
      and(eq(clientUsers.userId, userId), eq(clientUsers.clientId, clientId)),
    )
    .limit(1);
  return row;
}

export async function getClientUserRow(
  db: AppDb,
  clientUserId: string,
  clientId: string,
) {
  const [row] = await db
    .select()
    .from(clientUsers)
    .where(
      and(
        eq(clientUsers.id, clientUserId),
        eq(clientUsers.clientId, clientId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function updateClientUserRole(
  db: AppDb,
  clientUserId: string,
  clientId: string,
  role: 'client_admin' | 'client_operator',
) {
  const [row] = await db
    .update(clientUsers)
    .set({ role })
    .where(
      and(
        eq(clientUsers.id, clientUserId),
        eq(clientUsers.clientId, clientId),
      ),
    )
    .returning();
  return row;
}

export async function setClientUserActive(
  db: AppDb,
  clientUserId: string,
  clientId: string,
  isActive: boolean,
) {
  const [row] = await db
    .update(clientUsers)
    .set({ isActive })
    .where(
      and(
        eq(clientUsers.id, clientUserId),
        eq(clientUsers.clientId, clientId),
      ),
    )
    .returning();
  return row;
}

export async function countActiveClientAdmins(
  db: AppDb,
  clientId: string,
  excludeClientUserId?: string,
) {
  const base = [
    eq(clientUsers.clientId, clientId),
    eq(clientUsers.role, 'client_admin'),
    eq(clientUsers.isActive, true),
  ];
  if (excludeClientUserId) {
    base.push(ne(clientUsers.id, excludeClientUserId));
  }

  const rows = await db
    .select({ id: clientUsers.id })
    .from(clientUsers)
    .where(and(...base));

  return rows.length;
}

export async function getCompanyUserLink(
  db: AppDb,
  userId: string,
  companyId: string,
) {
  const [row] = await db
    .select()
    .from(companyUsers)
    .where(
      and(
        eq(companyUsers.userId, userId),
        eq(companyUsers.companyId, companyId),
      ),
    )
    .limit(1);
  return row;
}
