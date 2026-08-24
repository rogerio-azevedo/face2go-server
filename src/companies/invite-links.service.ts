import { Injectable, NotFoundException } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import * as invitesQueries from '../database/queries/invites.queries';

@Injectable()
export class InviteLinksService {
  constructor(private readonly database: DatabaseService) {}

  /** Retorno compatível com `getInvitePreviewAction` no Next.js. */
  async preview(code: string): Promise<{
    inviteType: 'company';
    role: 'company_admin' | 'company_operator';
    companyName: string;
  }> {
    const trimmed = code?.trim() ?? '';
    if (trimmed.length < 4) {
      throw new NotFoundException('Convite inválido ou expirado.');
    }

    const bundle = await invitesQueries.getInviteByCode(
      this.database.db,
      trimmed,
    );
    if (!bundle?.invite?.isActive) {
      throw new NotFoundException('Convite inválido ou expirado.');
    }

    const { invite, company } = bundle;
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      throw new NotFoundException('Convite inválido ou expirado.');
    }
    if (!company?.isActive) {
      throw new NotFoundException('Convite inválido ou expirado.');
    }

    return {
      inviteType: 'company',
      role: invite.role,
      companyName: company.name,
    };
  }
}
