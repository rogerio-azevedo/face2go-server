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
export class SchoolAccessService {
  constructor(
    private readonly database: DatabaseService,
    private readonly permissionsService: PermissionsService,
  ) {}

  private ensureCompany(user: JwtPayload): string {
    const companyId = user.companyId ?? undefined;
    if (!companyId) {
      throw new ForbiddenException('Sem permissão.');
    }
    return companyId;
  }

  /** Garante que o usuário pode gerenciar dados escolares deste cliente (`type === school`). */
  async assertManageSchoolClient(user: JwtPayload, clientId: string) {
    if (user.role === 'client_admin') {
      const tenantClientId = user.clientId ?? undefined;
      if (!tenantClientId || tenantClientId !== clientId) {
        throw new ForbiddenException('Sem permissão.');
      }
      const client = await clientsQueries.getClientByIdOnly(
        this.database.db,
        clientId,
      );
      if (!client) {
        throw new NotFoundException('Cliente não encontrado.');
      }
      if (client.type !== 'school') {
        throw new ForbiddenException('Este cliente não é uma escola.');
      }
      return client;
    }

    if (user.role !== 'company_admin' && user.role !== 'company_operator') {
      throw new ForbiddenException('Sem permissão.');
    }

    const companyId = this.ensureCompany(user);

    if (user.role === 'company_admin') {
      const client = await clientsQueries.getClientById(
        this.database.db,
        clientId,
        companyId,
      );
      if (!client) {
        throw new NotFoundException('Cliente não encontrado.');
      }
      if (client.type !== 'school') {
        throw new ForbiddenException('Este cliente não é uma escola.');
      }
      return client;
    }

    const ok = await this.permissionsService.evaluateCompanyFeatureAction(
      user.role,
      user.companyUserId,
      'clients',
      'can_read',
    );
    if (!ok) {
      throw new ForbiddenException('Sem permissão.');
    }

    const client = await clientsQueries.getClientById(
      this.database.db,
      clientId,
      companyId,
    );
    if (!client) {
      throw new NotFoundException('Cliente não encontrado.');
    }
    if (client.type !== 'school') {
      throw new ForbiddenException('Este cliente não é uma escola.');
    }
    return client;
  }
}
