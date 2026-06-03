import { and, desc, eq } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { inviteLinks } from '../schema';

import * as companiesQueries from './companies.queries';

export type GenerateInviteInput = {
  companyId: string;
  role: 'company_admin' | 'company_operator';
};

export type CompanyInviteListRow = {
  id: string;
  code: string;
  role: 'company_admin' | 'company_operator';
  usedCount: number;
  isActive: boolean;
  expiresAt: Date | null;
  createdAt: Date;
};

export async function generateInviteCode(
  db: AppDb,
  data: GenerateInviteInput,
): Promise<
  { success: true; code: string } | { success: false; error: string }
> {
  const code = Math.random().toString(36).substring(2, 10).toUpperCase();

  try {
    await db.insert(inviteLinks).values({
      companyId: data.companyId,
      role: data.role,
      code,
    });
    return { success: true, code };
  } catch {
    return { success: false, error: 'Falha ao gerar convite' };
  }
}

export async function getInviteByCode(db: AppDb, code: string) {
  const invite = await db.query.inviteLinks.findFirst({
    where: eq(inviteLinks.code, code),
  });
  if (!invite) return null;
  const company = await companiesQueries.getCompanyById(db, invite.companyId);
  return { invite, company: company ?? null };
}

export async function listCompanyInvites(
  db: AppDb,
  companyId: string,
): Promise<CompanyInviteListRow[]> {
  return db
    .select({
      id: inviteLinks.id,
      code: inviteLinks.code,
      role: inviteLinks.role,
      usedCount: inviteLinks.usedCount,
      isActive: inviteLinks.isActive,
      expiresAt: inviteLinks.expiresAt,
      createdAt: inviteLinks.createdAt,
    })
    .from(inviteLinks)
    .where(
      and(eq(inviteLinks.companyId, companyId), eq(inviteLinks.isActive, true)),
    )
    .orderBy(desc(inviteLinks.createdAt));
}

export async function incrementInviteUsedCount(db: AppDb, inviteId: string) {
  const row = await db.query.inviteLinks.findFirst({
    where: eq(inviteLinks.id, inviteId),
  });
  if (!row) return;
  await db
    .update(inviteLinks)
    .set({ usedCount: (row.usedCount ?? 0) + 1 })
    .where(eq(inviteLinks.id, inviteId));
}

export async function deactivateInvite(db: AppDb, inviteId: string) {
  await db
    .update(inviteLinks)
    .set({ isActive: false })
    .where(eq(inviteLinks.id, inviteId));
}
