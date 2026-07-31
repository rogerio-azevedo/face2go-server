import { and, asc, eq, isNull, ne } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { companyUsers, users } from '../schema';

export type UserRow = typeof users.$inferSelect;

export async function findUserByEmail(db: AppDb, email: string) {
  const normalized = email.trim().toLowerCase();
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);
  return row ?? null;
}

export async function findUserByCpf(db: AppDb, cpf: string) {
  const normalized = cpf.replace(/\D/g, '');
  if (normalized.length !== 11) return null;
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.cpf, normalized))
    .limit(1);
  return row ?? null;
}

export async function findUserByEmailOrCpf(
  db: AppDb,
  input: { email?: string; cpf?: string },
): Promise<{ byEmail: UserRow | null; byCpf: UserRow | null }> {
  const [byEmail, byCpf] = await Promise.all([
    input.email ? findUserByEmail(db, input.email) : Promise.resolve(null),
    input.cpf ? findUserByCpf(db, input.cpf) : Promise.resolve(null),
  ]);
  return { byEmail, byCpf };
}

export async function updateUserCpfIfMissing(
  db: AppDb,
  userId: string,
  cpf: string,
) {
  const normalized = cpf.replace(/\D/g, '');
  if (normalized.length !== 11) return;
  await db
    .update(users)
    .set({ cpf: normalized })
    .where(and(eq(users.id, userId), isNull(users.cpf)));
}

export type CompanyUserListRow = {
  companyUserId: string;
  userId: string;
  email: string;
  name: string | null;
  role: 'company_admin' | 'company_operator';
  jobTitle: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
};

export async function listCompanyUsers(
  db: AppDb,
  companyId: string,
): Promise<CompanyUserListRow[]> {
  return db
    .select({
      companyUserId: companyUsers.id,
      userId: users.id,
      email: users.email,
      name: users.name,
      role: companyUsers.role,
      jobTitle: companyUsers.jobTitle,
      phone: companyUsers.phone,
      isActive: companyUsers.isActive,
      createdAt: companyUsers.createdAt,
    })
    .from(companyUsers)
    .innerJoin(users, eq(companyUsers.userId, users.id))
    .where(eq(companyUsers.companyId, companyId))
    .orderBy(asc(users.name));
}

export async function getCompanyUserRow(
  db: AppDb,
  companyUserId: string,
  companyId: string,
) {
  const [row] = await db
    .select()
    .from(companyUsers)
    .where(
      and(
        eq(companyUsers.id, companyUserId),
        eq(companyUsers.companyId, companyId),
      ),
    )
    .limit(1);
  return row;
}

export async function updateCompanyUserRole(
  db: AppDb,
  companyUserId: string,
  companyId: string,
  role: 'company_admin' | 'company_operator',
) {
  const [row] = await db
    .update(companyUsers)
    .set({ role })
    .where(
      and(
        eq(companyUsers.id, companyUserId),
        eq(companyUsers.companyId, companyId),
      ),
    )
    .returning();
  return row;
}

export async function updateCompanyUserProfile(
  db: AppDb,
  companyUserId: string,
  companyId: string,
  input: { jobTitle?: string | null; phone?: string | null },
) {
  const setPayload: Partial<typeof companyUsers.$inferInsert> = {};
  if (input.jobTitle !== undefined) setPayload.jobTitle = input.jobTitle;
  if (input.phone !== undefined) setPayload.phone = input.phone;

  if (Object.keys(setPayload).length === 0) {
    return getCompanyUserRow(db, companyUserId, companyId);
  }

  const [row] = await db
    .update(companyUsers)
    .set(setPayload)
    .where(
      and(
        eq(companyUsers.id, companyUserId),
        eq(companyUsers.companyId, companyId),
      ),
    )
    .returning();
  return row;
}

export async function setCompanyUserActive(
  db: AppDb,
  companyUserId: string,
  companyId: string,
  isActive: boolean,
) {
  const [row] = await db
    .update(companyUsers)
    .set({ isActive })
    .where(
      and(
        eq(companyUsers.id, companyUserId),
        eq(companyUsers.companyId, companyId),
      ),
    )
    .returning();
  return row;
}

export async function countActiveAdmins(
  db: AppDb,
  companyId: string,
  excludeCompanyUserId?: string,
) {
  const base = [
    eq(companyUsers.companyId, companyId),
    eq(companyUsers.role, 'company_admin'),
    eq(companyUsers.isActive, true),
  ];
  if (excludeCompanyUserId) {
    base.push(ne(companyUsers.id, excludeCompanyUserId));
  }

  const rows = await db
    .select({ id: companyUsers.id })
    .from(companyUsers)
    .where(and(...base));

  return rows.length;
}
