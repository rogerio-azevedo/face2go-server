import { and, eq } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import {
  ALL_FEATURES,
  PREMIUM_FEATURE_SLUGS,
  type PremiumFeatureSlug,
} from '../../common/features.constants';
import { clients, companyFeatures, companyUsers } from '../schema';

export type CompanyFeatureRow = typeof companyFeatures.$inferSelect;

export async function getCompanyFeatures(
  db: AppDb,
  companyId: string,
): Promise<CompanyFeatureRow[]> {
  return db
    .select()
    .from(companyFeatures)
    .where(eq(companyFeatures.companyId, companyId));
}

export async function getCompanyFeatureFlags(
  db: AppDb,
  companyId: string,
): Promise<Record<PremiumFeatureSlug, boolean>> {
  const rows = await getCompanyFeatures(db, companyId);
  const bySlug = new Map(rows.map((row) => [row.featureSlug, row.enabled]));

  const flags = {} as Record<PremiumFeatureSlug, boolean>;
  for (const slug of PREMIUM_FEATURE_SLUGS) {
    flags[slug] = bySlug.get(slug) === true;
  }
  return flags;
}

export async function getCompanyFeatureBySlug(
  db: AppDb,
  companyId: string,
  featureSlug: string,
): Promise<CompanyFeatureRow | null> {
  const rows = await db
    .select()
    .from(companyFeatures)
    .where(
      and(
        eq(companyFeatures.companyId, companyId),
        eq(companyFeatures.featureSlug, featureSlug),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertCompanyFeature(
  db: AppDb,
  companyId: string,
  featureSlug: string,
  enabled: boolean,
  actorUserId: string | null,
): Promise<CompanyFeatureRow> {
  const now = new Date();
  const existing = await getCompanyFeatureBySlug(db, companyId, featureSlug);

  if (existing) {
    const rows = await db
      .update(companyFeatures)
      .set({
        enabled,
        enabledAt: enabled ? now : null,
        enabledBy: enabled ? actorUserId : null,
        updatedAt: now,
      })
      .where(eq(companyFeatures.id, existing.id))
      .returning();
    return rows[0];
  }

  const rows = await db
    .insert(companyFeatures)
    .values({
      companyId,
      featureSlug,
      enabled,
      enabledAt: enabled ? now : null,
      enabledBy: enabled ? actorUserId : null,
      updatedAt: now,
    })
    .returning();
  return rows[0];
}

export async function getCompanyIdByCompanyUserId(
  db: AppDb,
  companyUserId: string,
): Promise<string | null> {
  const rows = await db
    .select({ companyId: companyUsers.companyId })
    .from(companyUsers)
    .where(eq(companyUsers.id, companyUserId))
    .limit(1);
  return rows[0]?.companyId ?? null;
}

export async function getCompanyIdByClientId(
  db: AppDb,
  clientId: string,
): Promise<string | null> {
  const rows = await db
    .select({ companyId: clients.companyId })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  return rows[0]?.companyId ?? null;
}

export function listPremiumFeatureDefinitions() {
  return ALL_FEATURES.filter((feature) => feature.isPremium === true);
}
