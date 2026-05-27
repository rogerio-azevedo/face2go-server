import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ALL_FEATURES, type FeatureSlug, type PermissionAction } from '../common/features.constants';
import { DatabaseService } from '../database/database.service';
import * as permissionsQueries from '../database/queries/permissions.queries';
import * as invitesQueries from '../database/queries/invites.queries';
import * as companiesQueries from '../database/queries/companies.queries';
import * as usersQueries from '../database/queries/users.queries';
import { users } from '../database/schema';
import { generateCompanyInviteByAdminSchema } from '../validation/client-invites.schema';
import { zodFirstMessage } from '../validation/zod-utils';

const roleSchema = z.enum(['company_admin', 'company_operator']);

const updateRoleSchema = z.object({
  role: roleSchema,
});

const toggleActiveSchema = z.object({
  isActive: z.boolean(),
});

const profileSchema = z.object({
  name: z.string().trim().min(2).max(255).optional(),
  jobTitle: z.string().trim().min(2).max(120).optional().nullable(),
  phone: z.string().trim().min(8).max(30).optional().nullable(),
});

const permissionsSchema = z.object({
  featureSlug: z.string(),
  actions: z.array(
    z.enum(['can_read', 'can_create', 'can_update', 'can_delete']),
  ),
});

@Injectable()
export class CompanyUsersService {
  constructor(private readonly database: DatabaseService) {}

  private ensureCompanyAdmin(user: JwtPayload): string {
    if (!user.companyId || user.role !== 'company_admin') {
      throw new ForbiddenException('Sem permissão.');
    }
    return user.companyId;
  }

  async listWithPermissions(user: JwtPayload) {
    const companyId = this.ensureCompanyAdmin(user);
    const list = await usersQueries.listCompanyUsers(
      this.database.db,
      companyId,
    );

    const permissionsMap: Record<
      string,
      { featureSlug: string; actions: string[] }[]
    > = {};

    for (const u of list) {
      if (u.role === 'company_operator') {
        const rows = await permissionsQueries.listPermissionsForCompanyUser(
          this.database.db,
          u.companyUserId,
        );
        permissionsMap[u.companyUserId] = rows.map((r) => ({
          featureSlug: r.featureSlug,
          actions: r.actions as string[],
        }));
      }
    }

    return { users: list, permissionsMap };
  }

  async listInviteLinks(user: JwtPayload) {
    const companyId = this.ensureCompanyAdmin(user);
    const invites = await invitesQueries.listCompanyInvites(
      this.database.db,
      companyId,
    );
    return { invites };
  }

  async generateInviteLink(user: JwtPayload, body: unknown) {
    const companyId = this.ensureCompanyAdmin(user);
    const parsed = generateCompanyInviteByAdminSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const company = await companiesQueries.getCompanyById(
      this.database.db,
      companyId,
    );
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    if (!company.isActive) {
      throw new BadRequestException('Empresa inativa.');
    }

    const inviteResult = await invitesQueries.generateInviteCode(
      this.database.db,
      {
        companyId,
        role: parsed.data.role,
      },
    );
    if (inviteResult.success === false) {
      throw new BadRequestException(inviteResult.error);
    }
    return { code: inviteResult.code };
  }

  async updateRole(
    user: JwtPayload,
    companyUserId: string,
    body: unknown,
  ) {
    const companyId = this.ensureCompanyAdmin(user);
    const parsed = updateRoleSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const { role } = parsed.data;

    const row = await usersQueries.getCompanyUserRow(
      this.database.db,
      companyUserId,
      companyId,
    );
    if (!row) throw new NotFoundException('Usuário não encontrado.');
    if (row.userId === user.sub) {
      throw new BadRequestException(
        'Você não pode alterar seu próprio papel por aqui.',
      );
    }

    if (row.role === 'company_admin' && role === 'company_operator') {
      const others = await usersQueries.countActiveAdmins(
        this.database.db,
        companyId,
        companyUserId,
      );
      if (others < 1) {
        throw new BadRequestException(
          'Mantenha pelo menos outro administrador ativo antes desta alteração.',
        );
      }
    }

    await usersQueries.updateCompanyUserRole(
      this.database.db,
      companyUserId,
      companyId,
      role,
    );
    return { success: true };
  }

  async setActive(user: JwtPayload, companyUserId: string, body: unknown) {
    const companyId = this.ensureCompanyAdmin(user);
    const parsed = toggleActiveSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const { isActive } = parsed.data;

    const row = await usersQueries.getCompanyUserRow(
      this.database.db,
      companyUserId,
      companyId,
    );
    if (!row) throw new NotFoundException('Usuário não encontrado.');
    if (row.userId === user.sub) {
      throw new BadRequestException('Você não pode desativar a si mesmo.');
    }

    if (!isActive && row.role === 'company_admin') {
      const others = await usersQueries.countActiveAdmins(
        this.database.db,
        companyId,
        companyUserId,
      );
      if (others < 1) {
        throw new BadRequestException(
          'Mantenha pelo menos um administrador ativo na empresa.',
        );
      }
    }

    await usersQueries.setCompanyUserActive(
      this.database.db,
      companyUserId,
      companyId,
      isActive,
    );
    return { success: true };
  }

  async updateProfile(
    user: JwtPayload,
    companyUserId: string,
    body: unknown,
  ) {
    const companyId = this.ensureCompanyAdmin(user);
    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const { name, jobTitle, phone } = parsed.data;

    const row = await usersQueries.getCompanyUserRow(
      this.database.db,
      companyUserId,
      companyId,
    );
    if (!row) throw new NotFoundException('Usuário não encontrado.');

    if (name !== undefined) {
      await this.database.db
        .update(users)
        .set({ name })
        .where(eq(users.id, row.userId));
    }

    const phoneNorm =
      phone === null || phone === undefined
        ? phone
        : phone.replace(/\D/g, '') || phone.trim();

    if (jobTitle !== undefined || phone !== undefined) {
      await usersQueries.updateCompanyUserProfile(
        this.database.db,
        companyUserId,
        companyId,
        {
          ...(jobTitle !== undefined ? { jobTitle } : {}),
          ...(phone !== undefined ? { phone: phoneNorm } : {}),
        },
      );
    }

    return { success: true };
  }

  async updatePermissions(
    user: JwtPayload,
    companyUserId: string,
    body: unknown,
  ) {
    const companyId = this.ensureCompanyAdmin(user);
    const parsed = permissionsSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const { featureSlug, actions } = parsed.data;

    if (!ALL_FEATURES.some((f) => f.slug === featureSlug)) {
      throw new BadRequestException('Módulo inválido.');
    }

    const slug = featureSlug as FeatureSlug;

    const row = await usersQueries.getCompanyUserRow(
      this.database.db,
      companyUserId,
      companyId,
    );
    if (!row) throw new NotFoundException('Usuário não encontrado.');
    if (row.role === 'company_admin') {
      throw new BadRequestException(
        'Administradores já têm acesso amplo; altere o papel para operador para usar permissões granulares.',
      );
    }

    const uniqueActions = [...new Set(actions)] as PermissionAction[];

    if (uniqueActions.length === 0) {
      await permissionsQueries.deleteCompanyUserPermission(
        this.database.db,
        companyUserId,
        slug,
      );
    } else {
      await permissionsQueries.upsertCompanyUserPermission(
        this.database.db,
        companyUserId,
        slug,
        uniqueActions,
      );
    }

    return { success: true };
  }
}
