import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DatabaseService } from '../database/database.service';
import * as clientsQueries from '../database/queries/clients.queries';
import { PermissionsService } from '../permissions/permissions.service';
import type { UpdateRegistrationFieldsConfigDto } from '../validation/dto/registration-config.dto';
import {
  defaultConfigForClientType,
  listedFieldsForClientType,
  overrideFromResolved,
  resolveRegistrationFieldsConfig,
  type ResolvedRegistrationFieldsConfig,
} from './registration-fields-config';

export type RegistrationConfigResponse = {
  clientId: string;
  clientType: string;
  fields: ResolvedRegistrationFieldsConfig;
  listedFields: ReturnType<typeof listedFieldsForClientType>;
};

@Injectable()
export class RegistrationConfigService {
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

  private async ensureCompanyCanAccessClient(
    user: JwtPayload,
    clientId: string,
  ) {
    const companyId = this.ensureCompany(user);
    if (user.role === 'company_admin') {
      const client = await clientsQueries.getClientById(
        this.database.db,
        clientId,
        companyId,
      );
      if (!client) throw new NotFoundException('Cliente não encontrado.');
      return client;
    }
    if (user.role === 'company_operator') {
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
      if (!client) throw new NotFoundException('Cliente não encontrado.');
      return client;
    }
    throw new ForbiddenException('Sem permissão.');
  }

  private ensureClientTenant(user: JwtPayload): string {
    const clientId = user.clientId ?? undefined;
    if (
      !clientId ||
      (user.role !== 'client_admin' && user.role !== 'client_operator')
    ) {
      throw new ForbiddenException('Sem permissão.');
    }
    return clientId;
  }

  private toResponse(
    clientId: string,
    clientType: string,
    stored: unknown,
  ): RegistrationConfigResponse {
    const fields = resolveRegistrationFieldsConfig(clientType, stored);
    return {
      clientId,
      clientType,
      fields,
      listedFields: listedFieldsForClientType(clientType),
    };
  }

  async getForCompanyUser(user: JwtPayload, clientId: string) {
    const client = await this.ensureCompanyCanAccessClient(user, clientId);
    return this.toResponse(client.id, client.type, client.registrationConfig);
  }

  async getForClientTenant(user: JwtPayload) {
    const clientId = this.ensureClientTenant(user);
    const client = await clientsQueries.getClientByIdOnly(
      this.database.db,
      clientId,
    );
    if (!client) throw new NotFoundException('Cliente não encontrado.');
    return this.toResponse(client.id, client.type, client.registrationConfig);
  }

  private async save(
    clientId: string,
    clientType: string,
    stored: unknown,
    patch: UpdateRegistrationFieldsConfigDto,
  ) {
    const current = resolveRegistrationFieldsConfig(clientType, stored);
    const merged = {
      ...defaultConfigForClientType(clientType),
      ...current,
      ...patch,
    };
    const override = overrideFromResolved(clientType, merged);
    const updated = await clientsQueries.updateClientRegistrationConfig(
      this.database.db,
      clientId,
      override,
    );
    if (!updated) throw new NotFoundException('Cliente não encontrado.');
    return this.toResponse(
      updated.id,
      updated.type,
      updated.registrationConfig,
    );
  }

  async updateForCompanyUser(
    user: JwtPayload,
    clientId: string,
    patch: UpdateRegistrationFieldsConfigDto,
  ) {
    const client = await this.ensureCompanyCanAccessClient(user, clientId);
    return this.save(client.id, client.type, client.registrationConfig, patch);
  }

  async updateForClientTenant(
    user: JwtPayload,
    patch: UpdateRegistrationFieldsConfigDto,
  ) {
    const clientId = this.ensureClientTenant(user);
    const client = await clientsQueries.getClientByIdOnly(
      this.database.db,
      clientId,
    );
    if (!client) throw new NotFoundException('Cliente não encontrado.');
    return this.save(client.id, client.type, client.registrationConfig, patch);
  }
}
