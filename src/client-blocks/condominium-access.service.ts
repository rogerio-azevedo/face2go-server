import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import * as clientsQueries from '../database/queries/clients.queries';
import { DatabaseService } from '../database/database.service';
import { PermissionsService } from '../permissions/permissions.service';

@Injectable()
export class CondominiumAccessService {
  constructor(
    private readonly database: DatabaseService,
    private readonly permissionsService: PermissionsService,
  ) {}

  async assertRead(user: JwtPayload, clientId: string) {
    const client = await this.loadCondominium(user, clientId);
    return client;
  }

  async assertManage(user: JwtPayload, clientId: string) {
    if (user.role === 'client_operator') {
      throw new ForbiddenException('Sem permissão.');
    }
    return this.assertRead(user, clientId);
  }

  private async loadCondominium(user: JwtPayload, clientId: string) {
    if (user.role === 'client_admin' || user.role === 'client_operator') {
      const tenantClientId = user.clientId ?? undefined;
      if (!tenantClientId || tenantClientId !== clientId) {
        throw new ForbiddenException('Sem permissão.');
      }
      const client = await clientsQueries.getClientByIdOnly(
        this.database.db,
        clientId,
      );
      if (!client) throw new NotFoundException('Cliente não encontrado.');
      if (client.type !== 'condominium') {
        throw new ForbiddenException('Este cliente não é um condomínio.');
      }
      return client;
    }

    if (user.role !== 'company_admin' && user.role !== 'company_operator') {
      throw new ForbiddenException('Sem permissão.');
    }

    const companyId = user.companyId ?? undefined;
    if (!companyId) throw new ForbiddenException('Sem permissão.');

    if (user.role === 'company_operator') {
      const ok = await this.permissionsService.evaluateCompanyFeatureAction(
        user.role,
        user.companyUserId,
        'clients',
        'can_read',
      );
      if (!ok) throw new ForbiddenException('Sem permissão.');
    }

    const client = await clientsQueries.getClientById(
      this.database.db,
      clientId,
      companyId,
    );
    if (!client) throw new NotFoundException('Cliente não encontrado.');
    if (client.type !== 'condominium') {
      throw new ForbiddenException('Este cliente não é um condomínio.');
    }
    return client;
  }
}
