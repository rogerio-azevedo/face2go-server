import { and, asc, eq } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { companyUserPermissions, features } from '../schema';

export async function listFeaturesCatalog(db: AppDb) {
  return db.select().from(features).orderBy(asc(features.name));
}

export async function listPermissionsForCompanyUser(
  db: AppDb,
  companyUserId: string,
) {
  return db.query.companyUserPermissions.findMany({
    where: eq(companyUserPermissions.companyUserId, companyUserId),
  });
}

export async function upsertCompanyUserPermission(
  db: AppDb,
  companyUserId: string,
  featureSlug: string,
  actions: string[],
) {
  const now = new Date();
  await db
    .insert(companyUserPermissions)
    .values({
      companyUserId,
      featureSlug,
      actions,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        companyUserPermissions.companyUserId,
        companyUserPermissions.featureSlug,
      ],
      set: {
        actions,
        updatedAt: now,
      },
    });
}

export async function deleteCompanyUserPermission(
  db: AppDb,
  companyUserId: string,
  featureSlug: string,
) {
  await db
    .delete(companyUserPermissions)
    .where(
      and(
        eq(companyUserPermissions.companyUserId, companyUserId),
        eq(companyUserPermissions.featureSlug, featureSlug),
      ),
    );
}
