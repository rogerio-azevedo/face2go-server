import { and, eq } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { clientPanicConfig } from '../schema';

export type ClientPanicConfigRow = typeof clientPanicConfig.$inferSelect;

const DEFAULT_ALLOWED_ROLES = ['member'];

export async function getPanicConfigByClientId(
  db: AppDb,
  clientId: string,
): Promise<ClientPanicConfigRow | null> {
  const rows = await db
    .select()
    .from(clientPanicConfig)
    .where(eq(clientPanicConfig.clientId, clientId))
    .limit(1);
  return rows[0] ?? null;
}

export async function ensurePanicConfig(
  db: AppDb,
  clientId: string,
): Promise<ClientPanicConfigRow> {
  const existing = await getPanicConfigByClientId(db, clientId);
  if (existing) return existing;

  const rows = await db
    .insert(clientPanicConfig)
    .values({
      clientId,
      enabled: true,
      allowedRoles: DEFAULT_ALLOWED_ROLES,
      cooldownSeconds: 60,
      updatedAt: new Date(),
    })
    .returning();
  return rows[0]!;
}

export async function upsertPanicConfig(
  db: AppDb,
  clientId: string,
  data: {
    enabled?: boolean;
    allowedRoles?: string[];
    cooldownSeconds?: number;
  },
): Promise<ClientPanicConfigRow> {
  await ensurePanicConfig(db, clientId);
  const rows = await db
    .update(clientPanicConfig)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(clientPanicConfig.clientId, clientId))
    .returning();
  return rows[0]!;
}

export async function isRoleAllowedForPanic(
  db: AppDb,
  clientId: string,
  role: string,
): Promise<{ allowed: boolean; enabled: boolean; cooldownSeconds: number }> {
  const config = await ensurePanicConfig(db, clientId);
  const roles = Array.isArray(config.allowedRoles)
    ? config.allowedRoles
    : DEFAULT_ALLOWED_ROLES;
  return {
    allowed: config.enabled && roles.includes(role),
    enabled: config.enabled,
    cooldownSeconds: config.cooldownSeconds,
  };
}
