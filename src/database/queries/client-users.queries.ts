import { and, asc, eq } from 'drizzle-orm';

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
