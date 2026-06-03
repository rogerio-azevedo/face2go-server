import { ForbiddenException, Injectable } from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DatabaseService } from '../database/database.service';
import * as dashboardQueries from '../database/queries/dashboard.queries';

const COMPANY_ROLES = new Set(['company_admin', 'company_operator']);
const CLIENT_ROLES = new Set(['client_admin', 'client_operator', 'face_user']);

@Injectable()
export class DashboardService {
  constructor(private readonly database: DatabaseService) {}

  async getStats(user: JwtPayload) {
    if (COMPANY_ROLES.has(user.role)) {
      const companyId = user.companyId ?? undefined;
      if (!companyId) {
        throw new ForbiddenException('Sem permissão.');
      }
      return dashboardQueries.getCompanyDashboardStats(
        this.database.db,
        companyId,
      );
    }

    if (CLIENT_ROLES.has(user.role)) {
      const clientId = user.clientId ?? undefined;
      if (!clientId) {
        throw new ForbiddenException('Sem permissão.');
      }
      return dashboardQueries.getClientDashboardStats(
        this.database.db,
        clientId,
      );
    }

    throw new ForbiddenException('Sem permissão.');
  }
}
