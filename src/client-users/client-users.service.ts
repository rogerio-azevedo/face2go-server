import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { normalizeEmail } from '../auth/utils/auth-identifiers';
import { DatabaseService } from '../database/database.service';
import * as clientUsersQueries from '../database/queries/client-users.queries';
import * as clientsQueries from '../database/queries/clients.queries';
import * as usersQueries from '../database/queries/users.queries';
import { users } from '../database/schema';
import {
  patchClientUserActiveSchema,
  patchClientUserPasswordSchema,
  patchClientUserProfileSchema,
  patchClientUserRoleSchema,
} from '../validation/client-users.schema';
import { zodFirstMessage } from '../validation/zod-utils';

@Injectable()
export class ClientUsersService {
  constructor(private readonly database: DatabaseService) {}

  private async assertCanManage(
    user: JwtPayload,
    clientId: string,
  ): Promise<void> {
    if (user.role === 'company_admin') {
      if (!user.companyId) {
        throw new ForbiddenException('Sem permissão.');
      }
      const client = await clientsQueries.getClientById(
        this.database.db,
        clientId,
        user.companyId,
      );
      if (!client) {
        throw new NotFoundException('Cliente não encontrado.');
      }
      return;
    }

    if (user.role === 'client_admin') {
      if (!user.clientId || user.clientId !== clientId) {
        throw new ForbiddenException('Sem permissão.');
      }
      return;
    }

    throw new ForbiddenException('Sem permissão.');
  }

  async updateProfile(
    user: JwtPayload,
    clientId: string,
    clientUserId: string,
    body: unknown,
  ) {
    await this.assertCanManage(user, clientId);
    const parsed = patchClientUserProfileSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const row = await clientUsersQueries.getClientUserRow(
      this.database.db,
      clientUserId,
      clientId,
    );
    if (!row) throw new NotFoundException('Usuário não encontrado.');

    const setPayload: Partial<typeof users.$inferInsert> = {};
    if (parsed.data.name !== undefined) {
      setPayload.name = parsed.data.name;
    }
    if (parsed.data.email !== undefined) {
      const email = normalizeEmail(parsed.data.email);
      const taken = await usersQueries.findUserByEmail(this.database.db, email);
      if (taken && taken.id !== row.userId) {
        throw new BadRequestException('Este e-mail já está em uso.');
      }
      setPayload.email = email;
    }

    if (Object.keys(setPayload).length === 0) {
      return { success: true as const };
    }

    await this.database.db
      .update(users)
      .set(setPayload)
      .where(eq(users.id, row.userId));

    return { success: true as const };
  }

  async updateRole(
    user: JwtPayload,
    clientId: string,
    clientUserId: string,
    body: unknown,
  ) {
    await this.assertCanManage(user, clientId);
    const parsed = patchClientUserRoleSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const row = await clientUsersQueries.getClientUserRow(
      this.database.db,
      clientUserId,
      clientId,
    );
    if (!row) throw new NotFoundException('Usuário não encontrado.');
    if (row.userId === user.sub) {
      throw new BadRequestException(
        'Você não pode alterar seu próprio papel por aqui.',
      );
    }

    if (row.role === 'client_admin' && parsed.data.role === 'client_operator') {
      const others = await clientUsersQueries.countActiveClientAdmins(
        this.database.db,
        clientId,
        clientUserId,
      );
      if (others < 1) {
        throw new BadRequestException(
          'Mantenha pelo menos outro administrador ativo antes desta alteração.',
        );
      }
    }

    await clientUsersQueries.updateClientUserRole(
      this.database.db,
      clientUserId,
      clientId,
      parsed.data.role,
    );
    return { success: true as const };
  }

  async setActive(
    user: JwtPayload,
    clientId: string,
    clientUserId: string,
    body: unknown,
  ) {
    await this.assertCanManage(user, clientId);
    const parsed = patchClientUserActiveSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const row = await clientUsersQueries.getClientUserRow(
      this.database.db,
      clientUserId,
      clientId,
    );
    if (!row) throw new NotFoundException('Usuário não encontrado.');
    if (row.userId === user.sub) {
      throw new BadRequestException('Você não pode desativar a si mesmo.');
    }

    if (!parsed.data.isActive && row.role === 'client_admin') {
      const others = await clientUsersQueries.countActiveClientAdmins(
        this.database.db,
        clientId,
        clientUserId,
      );
      if (others < 1) {
        throw new BadRequestException(
          'Mantenha pelo menos um administrador ativo neste cliente.',
        );
      }
    }

    await clientUsersQueries.setClientUserActive(
      this.database.db,
      clientUserId,
      clientId,
      parsed.data.isActive,
    );
    return { success: true as const };
  }

  async setPassword(
    user: JwtPayload,
    clientId: string,
    clientUserId: string,
    body: unknown,
  ) {
    await this.assertCanManage(user, clientId);
    const parsed = patchClientUserPasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const row = await clientUsersQueries.getClientUserRow(
      this.database.db,
      clientUserId,
      clientId,
    );
    if (!row) throw new NotFoundException('Usuário não encontrado.');

    const password = await bcrypt.hash(parsed.data.password, 10);
    await this.database.db
      .update(users)
      .set({ password })
      .where(eq(users.id, row.userId));

    return { success: true as const };
  }
}
