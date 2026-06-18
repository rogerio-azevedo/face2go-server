import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  isPremiumFeatureSlug,
  type PremiumFeatureSlug,
} from '../common/features.constants';
import * as companiesQueries from '../database/queries/companies.queries';
import * as companyFeaturesQueries from '../database/queries/company-features.queries';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class CompanyFeaturesService {
  constructor(private readonly database: DatabaseService) {}

  async isEnabled(
    companyId: string,
    featureSlug: PremiumFeatureSlug,
  ): Promise<boolean> {
    const row = await companyFeaturesQueries.getCompanyFeatureBySlug(
      this.database.db,
      companyId,
      featureSlug,
    );
    return row?.enabled === true;
  }

  async assertEnabled(
    companyId: string,
    featureSlug: PremiumFeatureSlug,
  ): Promise<void> {
    const enabled = await this.isEnabled(companyId, featureSlug);
    if (!enabled) {
      throw new NotFoundException('Recurso não disponível para esta empresa.');
    }
  }

  async getFeatureFlags(
    companyId: string,
  ): Promise<Record<PremiumFeatureSlug, boolean>> {
    return companyFeaturesQueries.getCompanyFeatureFlags(
      this.database.db,
      companyId,
    );
  }

  async listForCompany(companyId: string) {
    const company = await companiesQueries.getCompanyById(
      this.database.db,
      companyId,
    );
    if (!company) {
      throw new NotFoundException('Empresa não encontrada.');
    }

    const rows = await companyFeaturesQueries.getCompanyFeatures(
      this.database.db,
      companyId,
    );
    const bySlug = new Map(rows.map((row) => [row.featureSlug, row]));

    return companyFeaturesQueries.listPremiumFeatureDefinitions().map(
      (definition) => {
        const row = bySlug.get(definition.slug);
        return {
          slug: definition.slug,
          name: definition.name,
          description: definition.description,
          category: definition.category,
          enabled: row?.enabled === true,
          enabledAt: row?.enabledAt?.toISOString() ?? null,
          enabledBy: row?.enabledBy ?? null,
        };
      },
    );
  }

  async toggle(
    companyId: string,
    featureSlug: string,
    enabled: boolean,
    actorUserId: string,
  ) {
    if (!isPremiumFeatureSlug(featureSlug)) {
      throw new BadRequestException('Feature premium inválida.');
    }

    const company = await companiesQueries.getCompanyById(
      this.database.db,
      companyId,
    );
    if (!company) {
      throw new NotFoundException('Empresa não encontrada.');
    }

    const row = await companyFeaturesQueries.upsertCompanyFeature(
      this.database.db,
      companyId,
      featureSlug,
      enabled,
      actorUserId,
    );

    const definition = companyFeaturesQueries
      .listPremiumFeatureDefinitions()
      .find((item) => item.slug === featureSlug);

    return {
      slug: featureSlug,
      name: definition?.name ?? featureSlug,
      description: definition?.description ?? '',
      category: definition?.category ?? 'Premium',
      enabled: row.enabled,
      enabledAt: row.enabledAt?.toISOString() ?? null,
      enabledBy: row.enabledBy ?? null,
    };
  }
}
