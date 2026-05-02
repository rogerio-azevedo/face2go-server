import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import type { FeatureSlug } from '../common/features.constants';
import { DatabaseService } from '../database/database.service';
import * as clientsQueries from '../database/queries/clients.queries';
import { PermissionsService } from '../permissions/permissions.service';
import {
  createClientSchema,
  updateClientSchema,
} from '../validation/clients.schema';
import { zodFirstMessage } from '../validation/zod-utils';

const toggleActiveSchema = z.object({
  isActive: z.boolean(),
});

@Injectable()
export class ClientsService {
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

  /** Lista clientes (admin ou operador com `clients` + can_read). */
  async list(user: JwtPayload) {
    const companyId = this.ensureCompany(user);
    if (user.role === 'company_admin') {
      return clientsQueries.listClients(this.database.db, companyId);
    }
    if (user.role === 'company_operator') {
      const ok = await this.permissionsService.evaluateCompanyFeatureAction(
        user.role,
        user.companyUserId,
        'clients' as FeatureSlug,
        'can_read',
      );
      if (!ok) {
        throw new ForbiddenException('Sem permissão.');
      }
      return clientsQueries.listClients(this.database.db, companyId);
    }
    throw new ForbiddenException('Sem permissão.');
  }

  /** Escrita: apenas company_admin (comportamento atual do Next.js). */
  async create(user: JwtPayload, body: unknown) {
    if (user.role !== 'company_admin') {
      throw new ForbiddenException('Sem permissão.');
    }
    const companyId = this.ensureCompany(user);
    const parsed = createClientSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    return clientsQueries.createClient(this.database.db, {
      companyId,
      name: parsed.data.name,
      type: parsed.data.type,
      cnpj: parsed.data.cnpj,
      phone: parsed.data.phone,
      email: parsed.data.email,
      logoUrl: parsed.data.logoUrl,
      timezoneOffsetMinutes: parsed.data.timezoneOffsetMinutes,
      isActive: parsed.data.isActive,
    });
  }

  async update(user: JwtPayload, clientId: string, body: unknown) {
    if (user.role !== 'company_admin') {
      throw new ForbiddenException('Sem permissão.');
    }
    const companyId = this.ensureCompany(user);
    const parsed = updateClientSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;
    if (
      d.name === undefined &&
      d.type === undefined &&
      d.cnpj === undefined &&
      d.phone === undefined &&
      d.email === undefined &&
      d.logoUrl === undefined &&
      d.timezoneOffsetMinutes === undefined &&
      d.isActive === undefined
    ) {
      throw new BadRequestException('Nada para atualizar.');
    }
    const updated = await clientsQueries.updateClient(
      this.database.db,
      clientId,
      companyId,
      {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.type !== undefined ? { type: d.type } : {}),
        ...(d.cnpj !== undefined ? { cnpj: d.cnpj } : {}),
        ...(d.phone !== undefined ? { phone: d.phone } : {}),
        ...(d.email !== undefined ? { email: d.email } : {}),
        ...(d.logoUrl !== undefined ? { logoUrl: d.logoUrl } : {}),
        ...(d.timezoneOffsetMinutes !== undefined
          ? { timezoneOffsetMinutes: d.timezoneOffsetMinutes }
          : {}),
        ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      },
    );
    if (!updated) throw new NotFoundException('Cliente não encontrado.');
    return updated;
  }

  async setActive(user: JwtPayload, clientId: string, body: unknown) {
    if (user.role !== 'company_admin') {
      throw new ForbiddenException('Sem permissão.');
    }
    const companyId = this.ensureCompany(user);
    const parsed = toggleActiveSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const existing = await clientsQueries.getClientById(
      this.database.db,
      clientId,
      companyId,
    );
    if (!existing) throw new NotFoundException('Cliente não encontrado.');
    return clientsQueries.setClientActive(
      this.database.db,
      clientId,
      companyId,
      parsed.data.isActive,
    );
  }
}
