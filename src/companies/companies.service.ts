import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import * as companiesQueries from '../database/queries/companies.queries';
import * as invitesQueries from '../database/queries/invites.queries';
import * as usersQueries from '../database/queries/users.queries';
import {
  createCompanySchema,
  updateCompanySchema,
} from '../validation/companies.schema';
import { generateInviteSchema } from '../validation/invites.schema';
import { zodFirstMessage } from '../validation/zod-utils';

@Injectable()
export class CompaniesService {
  constructor(private readonly database: DatabaseService) {}

  async list(includeInactive: boolean) {
    return companiesQueries.listCompanies(this.database.db, {
      includeInactive,
    });
  }

  async getById(id: string) {
    const row = await companiesQueries.getCompanyById(this.database.db, id);
    if (!row) throw new NotFoundException('Empresa não encontrada.');
    return row;
  }

  async create(body: unknown) {
    const parsed = createCompanySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    try {
      return await companiesQueries.createCompany(this.database.db, {
        name: parsed.data.name,
        cnpj: parsed.data.cnpj ?? null,
        phone: parsed.data.phone ?? null,
        email: parsed.data.email ?? null,
        logoUrl: parsed.data.logoUrl ?? null,
        isActive: parsed.data.isActive,
      });
    } catch (e) {
      const message =
        e instanceof Error && e.message.includes('slug')
          ? e.message
          : 'Não foi possível criar a empresa.';
      throw new BadRequestException(message);
    }
  }

  async update(id: string, body: unknown) {
    const parsed = updateCompanySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;
    try {
      const row = await companiesQueries.updateCompany(this.database.db, id, {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.cnpj !== undefined ? { cnpj: d.cnpj ?? null } : {}),
        ...(d.phone !== undefined ? { phone: d.phone ?? null } : {}),
        ...(d.email !== undefined ? { email: d.email ?? null } : {}),
        ...(d.logoUrl !== undefined ? { logoUrl: d.logoUrl ?? null } : {}),
        ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      });
      if (!row) throw new NotFoundException('Empresa não encontrada.');
      return row;
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      const message =
        e instanceof Error && e.message.includes('slug')
          ? e.message
          : 'Não foi possível atualizar a empresa.';
      throw new BadRequestException(message);
    }
  }

  async softDelete(id: string) {
    const row = await companiesQueries.softDeleteCompany(this.database.db, id);
    if (!row) throw new NotFoundException('Empresa não encontrada.');
    return row;
  }

  async generateInvite(companyId: string, role: string) {
    const parsed = generateInviteSchema.safeParse({ companyId, role });
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const company = await companiesQueries.getCompanyById(
      this.database.db,
      parsed.data.companyId,
    );
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    if (!company.isActive) {
      throw new BadRequestException('Empresa inativa.');
    }

    const inviteResult = await invitesQueries.generateInviteCode(
      this.database.db,
      parsed.data,
    );
    if (inviteResult.success === false) {
      throw new BadRequestException(inviteResult.error);
    }
    return { code: inviteResult.code };
  }

  async listCompanyUsersForSuperAdmin(companyId: string) {
    return usersQueries.listCompanyUsers(this.database.db, companyId);
  }
}
