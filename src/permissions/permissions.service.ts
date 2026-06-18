import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import {
  ALL_FEATURES,
  isPremiumFeatureSlug,
  type FeatureSlug,
  type PermissionAction,
} from '../common/features.constants';
import { ROUTE_PERMISSIONS } from '../common/route-permissions.constants';
import { CompanyFeaturesService } from '../company-features/company-features.service';
import { DatabaseService } from '../database/database.service';
import * as companyFeaturesQueries from '../database/queries/company-features.queries';
import { companyUserPermissions } from '../database/schema';

@Injectable()
export class PermissionsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly companyFeaturesService: CompanyFeaturesService,
  ) {}

  async evaluateCompanyFeatureAction(
    role: string,
    companyUserId: string | undefined | null,
    featureSlug: FeatureSlug,
    action: PermissionAction,
    companyId?: string | null,
  ): Promise<boolean> {
    if (role === 'super_admin') return true;
    if (!companyUserId) return false;

    const resolvedCompanyId =
      companyId ??
      (await companyFeaturesQueries.getCompanyIdByCompanyUserId(
        this.database.db,
        companyUserId,
      ));
    if (!resolvedCompanyId) return false;

    if (isPremiumFeatureSlug(featureSlug)) {
      const companyEnabled = await this.companyFeaturesService.isEnabled(
        resolvedCompanyId,
        featureSlug,
      );
      if (!companyEnabled) return false;
    }

    const permission =
      await this.database.db.query.companyUserPermissions.findFirst({
        where: and(
          eq(companyUserPermissions.companyUserId, companyUserId),
          eq(companyUserPermissions.featureSlug, featureSlug),
        ),
      });

    if (role === 'company_admin') {
      if (!permission) return true;
      return permission.actions.includes(action);
    }

    if (role === 'company_operator') {
      return permission?.actions.includes(action) ?? false;
    }

    return false;
  }

  /** Equivalente a `getSidebarNavAccess` do Next.js (paths permitidos na sidebar empresa). */
  async getSidebarNavAccess(user: {
    role?: string;
    companyId?: string | null;
    companyUserId?: string | null;
  }): Promise<{ mainPaths: string[] | null }> {
    if (!user.role) {
      return { mainPaths: null };
    }

    if (user.role === 'super_admin') {
      return { mainPaths: null };
    }

    if (!user.companyId || !user.companyUserId) {
      return { mainPaths: ['/company/dashboard'] };
    }

    const companyFeatureFlags = await this.companyFeaturesService.getFeatureFlags(
      user.companyId,
    );

    if (user.role === 'company_admin') {
      const rows = await this.database.db.query.companyUserPermissions.findMany(
        {
          where: eq(companyUserPermissions.companyUserId, user.companyUserId),
        },
      );

      const readableSlugs = this.readableFeatureSlugsFromPermissionRows(
        rows,
        'company_admin',
      );

      const mainPaths = new Set<string>(['/company/dashboard']);
      for (const [path, slug] of Object.entries(ROUTE_PERMISSIONS)) {
        if (slug && readableSlugs.has(slug)) {
          if (
            isPremiumFeatureSlug(slug) &&
            companyFeatureFlags[slug] !== true
          ) {
            continue;
          }
          mainPaths.add(path);
        }
      }
      return { mainPaths: [...mainPaths] };
    }

    if (user.role === 'company_operator') {
      const rows = await this.database.db.query.companyUserPermissions.findMany(
        {
          where: eq(companyUserPermissions.companyUserId, user.companyUserId),
        },
      );

      const readableSlugs = this.readableFeatureSlugsFromPermissionRows(
        rows,
        'company_operator',
      );

      const mainPaths = new Set<string>(['/company/dashboard']);
      for (const [path, slug] of Object.entries(ROUTE_PERMISSIONS)) {
        if (slug && readableSlugs.has(slug)) {
          if (
            isPremiumFeatureSlug(slug) &&
            companyFeatureFlags[slug] !== true
          ) {
            continue;
          }
          mainPaths.add(path);
        }
      }
      return { mainPaths: [...mainPaths] };
    }

    return { mainPaths: null };
  }

  private readableFeatureSlugsFromPermissionRows(
    rows: { featureSlug: string; actions: string[] }[],
    companyRole: 'company_admin' | 'company_operator' | null | undefined,
  ): Set<FeatureSlug> {
    const bySlug = new Map<string, string[]>();
    for (const r of rows) {
      bySlug.set(r.featureSlug, r.actions);
    }

    const readable = new Set<FeatureSlug>();
    for (const f of ALL_FEATURES) {
      const slug = f.slug;
      const actions = bySlug.get(slug);
      if (companyRole === 'company_admin') {
        if (!actions) {
          readable.add(slug);
        } else if (actions.includes('can_read')) {
          readable.add(slug);
        }
      } else if (actions?.includes('can_read')) {
        readable.add(slug);
      }
    }
    return readable;
  }

  /** Lista de ações permitidas para uma feature (equivalente a `getPermissions` no Next.js). */
  async getEffectivePermissionActions(
    user: JwtPayloadLike,
    featureSlug: FeatureSlug,
  ): Promise<PermissionAction[]> {
    const ALL_PERMISSION_ACTIONS: PermissionAction[] = [
      'can_read',
      'can_create',
      'can_update',
      'can_delete',
    ];

    if (!user.companyId) return [];

    if (user.role === 'super_admin') {
      return [...ALL_PERMISSION_ACTIONS];
    }

    const companyUserId = user.companyUserId;
    if (!companyUserId) return [];

    if (isPremiumFeatureSlug(featureSlug)) {
      const companyEnabled = await this.companyFeaturesService.isEnabled(
        user.companyId,
        featureSlug,
      );
      if (!companyEnabled) return [];
    }

    const permission =
      await this.database.db.query.companyUserPermissions.findFirst({
        where: and(
          eq(companyUserPermissions.companyUserId, companyUserId),
          eq(companyUserPermissions.featureSlug, featureSlug),
        ),
      });

    if (user.role === 'company_admin') {
      if (!permission) return [...ALL_PERMISSION_ACTIONS];
      return (permission.actions ?? []) as PermissionAction[];
    }

    return (permission?.actions ?? []) as PermissionAction[];
  }
}

/** Subconjunto dos campos JWT usados em checagens de permissão. */
export type JwtPayloadLike = {
  role?: string;
  companyId?: string | null;
  companyUserId?: string | null;
};
