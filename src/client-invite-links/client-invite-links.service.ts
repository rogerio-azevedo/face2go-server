import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DatabaseService } from '../database/database.service';
import * as clientInviteLinksQueries from '../database/queries/client-invite-links.queries';
import * as clientUsersQueries from '../database/queries/client-users.queries';
import { zodFirstMessage } from '../validation/zod-utils';

const generateClientSelfInviteSchema = z.object({
  role: z.enum(['client_admin', 'client_operator']),
});

@Injectable()
export class ClientInviteLinksService {
  constructor(private readonly database: DatabaseService) {}

  private ensureClientAdmin(user: JwtPayload): string {
    if (!user.clientId || user.role !== 'client_admin') {
      throw new ForbiddenException('Sem permissão.');
    }
    return user.clientId;
  }

  async listForCurrentClient(user: JwtPayload) {
    const clientId = this.ensureClientAdmin(user);
    const invites = await clientInviteLinksQueries.listClientInvites(
      this.database.db,
      clientId,
    );
    return { invites };
  }

  async generateForCurrentClient(user: JwtPayload, body: unknown) {
    const clientId = this.ensureClientAdmin(user);
    const parsed = generateClientSelfInviteSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const inviteResult =
      await clientInviteLinksQueries.generateClientInviteCode(
        this.database.db,
        {
          clientId,
          role: parsed.data.role,
        },
      );
    if (inviteResult.success === false) {
      throw new BadRequestException(inviteResult.error);
    }
    return { code: inviteResult.code };
  }

  async listClientUsersForCurrentClient(user: JwtPayload) {
    const clientId = this.ensureClientAdmin(user);
    const users = await clientUsersQueries.listClientUsers(
      this.database.db,
      clientId,
    );
    return { users };
  }

  async preview(code: string): Promise<{
    inviteType: 'client';
    role: 'client_admin' | 'client_operator';
    clientName: string;
    companyName: string;
  }> {
    const trimmed = code?.trim() ?? '';
    if (trimmed.length < 4) {
      throw new NotFoundException('Convite inválido ou expirado.');
    }

    const bundle = await clientInviteLinksQueries.getClientInviteByCode(
      this.database.db,
      trimmed,
    );
    if (!bundle?.invite?.isActive || !bundle.client?.isActive) {
      throw new NotFoundException('Convite inválido ou expirado.');
    }
    if (bundle.invite.expiresAt && bundle.invite.expiresAt < new Date()) {
      throw new NotFoundException('Convite inválido ou expirado.');
    }
    if (!bundle.company?.isActive) {
      throw new NotFoundException('Convite inválido ou expirado.');
    }

    return {
      inviteType: 'client',
      role: bundle.invite.role,
      clientName: bundle.client.name,
      companyName: bundle.company.name,
    };
  }
}
