import { ForbiddenException, Injectable, Logger } from '@nestjs/common';

import { AccessesService } from '../accesses/accesses.service';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DatabaseService } from '../database/database.service';
import * as clientsQueries from '../database/queries/clients.queries';
import * as dashboardQueries from '../database/queries/dashboard.queries';
import { FaceListenerService } from '../face-listener/face-listener.service';
import type { ClientDashboard } from '../validation/dashboard.schema';

const COMPANY_ROLES = new Set(['company_admin', 'company_operator']);
const CLIENT_ROLES = new Set(['client_admin', 'client_operator', 'face_user']);

const EMPTY_ACCESS_SUMMARY = {
  accessesToday: { granted: 0, denied: 0 },
  recentAccesses: [],
} as const;

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly accesses: AccessesService,
    private readonly faceListener: FaceListenerService,
  ) {}

  async getStats(user: JwtPayload) {
    if (!COMPANY_ROLES.has(user.role)) {
      throw new ForbiddenException('Sem permissão.');
    }
    const companyId = user.companyId ?? undefined;
    if (!companyId) {
      throw new ForbiddenException('Sem permissão.');
    }
    return dashboardQueries.getCompanyDashboardStats(
      this.database.db,
      companyId,
    );
  }

  async getClientOverview(user: JwtPayload): Promise<ClientDashboard> {
    if (!CLIENT_ROLES.has(user.role)) {
      throw new ForbiddenException('Sem permissão.');
    }
    const clientId = user.clientId?.trim();
    const companyId = user.companyId?.trim();
    if (!clientId || !companyId) {
      throw new ForbiddenException('Sem permissão.');
    }

    const client = await clientsQueries.getClientById(
      this.database.db,
      clientId,
      companyId,
    );
    if (!client) {
      throw new ForbiddenException('Sem permissão.');
    }

    const timezoneOffsetMinutes = client.timezoneOffsetMinutes ?? 0;
    const [facts, accesses, monitor] = await Promise.all([
      dashboardQueries.getClientDashboardFacts(this.database.db, clientId),
      this.accesses
        .getClientDashboardSummary(companyId, clientId, timezoneOffsetMinutes)
        .catch((err: unknown) => {
          this.logger.warn(
            `Resumo de acessos do painel falhou: ${err instanceof Error ? err.message : String(err)}`,
          );
          return {
            accessesToday: { ...EMPTY_ACCESS_SUMMARY.accessesToday },
            recentAccesses: [],
          };
        }),
      this.faceListener
        .getMonitorReportForCompany(companyId, clientId)
        .catch((err: unknown) => {
          this.logger.warn(
            `Status dos leitores do painel falhou: ${err instanceof Error ? err.message : String(err)}`,
          );
          return null;
        }),
    ]);

    return {
      clientType: client.type,
      segment: client.segment,
      timezoneOffsetMinutes,
      registrations: {
        pending: facts.pendingRegistrations,
        approved: facts.approvedRegistrations,
      },
      activeRegistrationLinks: facts.activeRegistrationLinks,
      people: {
        members: facts.members,
        students: facts.students,
        responsibles: facts.responsibles,
      },
      schoolClasses: facts.schoolClasses,
      vehicles: facts.vehicles,
      cameras: facts.cameras,
      readers: {
        total: monitor?.summary.total ?? facts.readers,
        online: monitor?.summary.connected ?? 0,
      },
      accessesToday: accesses.accessesToday,
      recentAccesses: accesses.recentAccesses,
    };
  }
}
