import { and, desc, eq } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { clientInviteLinks, clients, companies } from '../schema';

export type GenerateClientInviteInput = {
  clientId: string;
  role: 'client_admin' | 'client_operator';
};

export type ClientInviteListRow = {
  id: string;
  code: string;
  role: 'client_admin' | 'client_operator';
  usedCount: number;
  isActive: boolean;
  expiresAt: Date | null;
  createdAt: Date;
};

function randomInviteCode(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

export async function generateClientInviteCode(
  db: AppDb,
  data: GenerateClientInviteInput,
): Promise<{ success: true; code: string } | { success: false; error: string }> {
  const code = randomInviteCode();

  try {
    await db.insert(clientInviteLinks).values({
      clientId: data.clientId,
      role: data.role,
      code,
    });
    return { success: true, code };
  } catch {
    return { success: false, error: 'Falha ao gerar convite' };
  }
}

export async function getClientInviteByCode(db: AppDb, code: string) {
  const invite = await db.query.clientInviteLinks.findFirst({
    where: eq(clientInviteLinks.code, code),
  });
  if (!invite) return null;

  const [clientRow] = await db
    .select({
      id: clients.id,
      name: clients.name,
      companyId: clients.companyId,
      isActive: clients.isActive,
    })
    .from(clients)
    .where(eq(clients.id, invite.clientId))
    .limit(1);

  if (!clientRow) {
    return { invite, client: null, company: null };
  }

  const [companyRow] = await db
    .select({
      id: companies.id,
      name: companies.name,
      isActive: companies.isActive,
    })
    .from(companies)
    .where(eq(companies.id, clientRow.companyId))
    .limit(1);

  return {
    invite,
    client: clientRow,
    company: companyRow ?? null,
  };
}

export async function listClientInvites(
  db: AppDb,
  clientId: string,
): Promise<ClientInviteListRow[]> {
  return db
    .select({
      id: clientInviteLinks.id,
      code: clientInviteLinks.code,
      role: clientInviteLinks.role,
      usedCount: clientInviteLinks.usedCount,
      isActive: clientInviteLinks.isActive,
      expiresAt: clientInviteLinks.expiresAt,
      createdAt: clientInviteLinks.createdAt,
    })
    .from(clientInviteLinks)
    .where(
      and(
        eq(clientInviteLinks.clientId, clientId),
        eq(clientInviteLinks.isActive, true),
      ),
    )
    .orderBy(desc(clientInviteLinks.createdAt));
}

export async function incrementClientInviteUsedCount(
  db: AppDb,
  inviteId: string,
) {
  const row = await db.query.clientInviteLinks.findFirst({
    where: eq(clientInviteLinks.id, inviteId),
  });
  if (!row) return;
  await db
    .update(clientInviteLinks)
    .set({ usedCount: (row.usedCount ?? 0) + 1 })
    .where(eq(clientInviteLinks.id, inviteId));
}

export async function deactivateClientInvite(db: AppDb, inviteId: string) {
  await db
    .update(clientInviteLinks)
    .set({ isActive: false })
    .where(eq(clientInviteLinks.id, inviteId));
}
