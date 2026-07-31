import { BadRequestException, Injectable } from '@nestjs/common';

import { normalizeCpf } from '../auth/utils/auth-identifiers';
import { DatabaseService } from '../database/database.service';
import * as membersQueries from '../database/queries/members.queries';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as usersQueries from '../database/queries/users.queries';
import type {
  PersonLookupContext,
  PersonLookupProfile,
  PersonLookupResult,
} from '../validation/people.schema';
import { personLookupQuerySchema } from '../validation/people.schema';
import { zodFirstMessage } from '../validation/zod-utils';

@Injectable()
export class PersonLookupService {
  constructor(private readonly database: DatabaseService) {}

  async lookup(input: unknown): Promise<PersonLookupResult> {
    const parsed = personLookupQuerySchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    return this.resolvePerson(parsed.data);
  }

  async resolvePerson(input: {
    cpf?: string;
    email?: string;
  }): Promise<PersonLookupResult> {
    const cpf = input.cpf ? normalizeCpf(input.cpf) : '';
    const email = input.email?.trim().toLowerCase();

    const { byEmail, byCpf } = await usersQueries.findUserByEmailOrCpf(
      this.database.db,
      { email, cpf: cpf.length === 11 ? cpf : undefined },
    );

    if (byEmail && byCpf && byEmail.id !== byCpf.id) {
      return {
        matched: true,
        userId: null,
        hasLogin: false,
        profile: null,
        contexts: [],
        conflict:
          'CPF e e-mail pertencem a contas diferentes. Verifique os dados informados.',
      };
    }

    const [membersByDoc, responsiblesByDoc, membersByEmail] = await Promise.all(
      [
        cpf.length === 11
          ? membersQueries.findMembersByDocumentGlobally(this.database.db, cpf)
          : Promise.resolve([]),
        cpf.length === 11
          ? responsiblesQueries.findResponsiblesByDocumentGlobally(
              this.database.db,
              cpf,
            )
          : Promise.resolve([]),
        email
          ? membersQueries.findMembersByEmailGlobally(this.database.db, email)
          : Promise.resolve([]),
      ],
    );

    const userIds = new Set<string>();
    if (byEmail) userIds.add(byEmail.id);
    if (byCpf) userIds.add(byCpf.id);
    for (const row of [
      ...membersByDoc,
      ...membersByEmail,
      ...responsiblesByDoc,
    ]) {
      if (row.userId) userIds.add(row.userId);
    }

    if (userIds.size > 1) {
      return {
        matched: true,
        userId: null,
        hasLogin: false,
        profile: null,
        contexts: [],
        conflict:
          'Os dados informados apontam para pessoas diferentes. Verifique CPF e e-mail.',
      };
    }

    const resolvedUser = byEmail ?? byCpf ?? null;
    const resolvedUserId = resolvedUser?.id ?? [...userIds][0] ?? null;

    const legacyProfiles = [
      ...membersByDoc.filter((row) => !row.userId),
      ...membersByEmail.filter((row) => !row.userId),
      ...responsiblesByDoc.filter((row) => !row.userId),
    ];

    const hasLinkedProfiles =
      membersByDoc.length > 0 ||
      responsiblesByDoc.length > 0 ||
      membersByEmail.length > 0;

    if (!resolvedUserId && !hasLinkedProfiles) {
      return {
        matched: false,
        userId: null,
        hasLogin: false,
        profile: null,
        contexts: [],
      };
    }

    const contexts = await this.buildContexts(resolvedUserId, {
      membersByDoc,
      membersByEmail,
      responsiblesByDoc,
    });

    const profile = this.buildProfile(resolvedUser, {
      membersByDoc,
      membersByEmail,
      responsiblesByDoc,
      legacyProfiles,
    });

    return {
      matched: true,
      userId: resolvedUserId,
      hasLogin: resolvedUserId !== null,
      profile,
      contexts,
    };
  }

  async linkLegacyProfilesByDocument(document: string, userId: string) {
    const normalized = normalizeCpf(document);
    if (normalized.length !== 11) return;
    await membersQueries.linkLegacyMembersByDocument(
      this.database.db,
      normalized,
      userId,
    );
    await responsiblesQueries.linkLegacyResponsiblesByDocument(
      this.database.db,
      normalized,
      userId,
    );
  }

  private async buildContexts(
    userId: string | null,
    seed: {
      membersByDoc: membersQueries.MemberProfileContextRow[];
      membersByEmail: membersQueries.MemberProfileContextRow[];
      responsiblesByDoc: responsiblesQueries.ResponsibleProfileContextRow[];
    },
  ): Promise<PersonLookupContext[]> {
    const seen = new Set<string>();
    const contexts: PersonLookupContext[] = [];

    const push = (ctx: PersonLookupContext) => {
      const key = `${ctx.type}:${ctx.clientId}`;
      if (seen.has(key)) return;
      seen.add(key);
      contexts.push(ctx);
    };

    if (userId) {
      const [members, responsibles] = await Promise.all([
        membersQueries.listMemberContextsByUserId(this.database.db, userId),
        responsiblesQueries.listResponsibleContextsByUserId(
          this.database.db,
          userId,
        ),
      ]);
      for (const row of members) {
        push({
          type: 'member',
          clientId: row.clientId,
          clientName: row.clientName,
          isActive: row.isActive,
          hasLogin: row.userId !== null,
        });
      }
      for (const row of responsibles) {
        push({
          type: 'responsible',
          clientId: row.clientId,
          clientName: row.clientName,
          isActive: row.isActive,
          hasLogin: row.userId !== null,
        });
      }
    }

    for (const row of seed.membersByDoc) {
      push({
        type: 'member',
        clientId: row.clientId,
        clientName: row.clientName,
        isActive: row.isActive,
        hasLogin: row.userId !== null,
      });
    }
    for (const row of seed.membersByEmail) {
      push({
        type: 'member',
        clientId: row.clientId,
        clientName: row.clientName,
        isActive: row.isActive,
        hasLogin: row.userId !== null,
      });
    }
    for (const row of seed.responsiblesByDoc) {
      push({
        type: 'responsible',
        clientId: row.clientId,
        clientName: row.clientName,
        isActive: row.isActive,
        hasLogin: row.userId !== null,
      });
    }

    return contexts.sort((a, b) => a.clientName.localeCompare(b.clientName));
  }

  private buildProfile(
    user: usersQueries.UserRow | null,
    seed: {
      membersByDoc: membersQueries.MemberProfileContextRow[];
      membersByEmail: membersQueries.MemberProfileContextRow[];
      responsiblesByDoc: responsiblesQueries.ResponsibleProfileContextRow[];
      legacyProfiles: Array<{
        name: string;
        email: string | null;
        phone: string | null;
      }>;
    },
  ): PersonLookupProfile | null {
    if (user) {
      const fallback = seed.legacyProfiles[0];
      return {
        name: user.name ?? fallback?.name ?? '',
        email: user.email,
        phone: fallback?.phone ?? null,
      };
    }

    const profile =
      seed.responsiblesByDoc[0] ??
      seed.membersByDoc[0] ??
      seed.membersByEmail[0] ??
      seed.legacyProfiles[0];

    if (!profile) return null;

    return {
      name: profile.name,
      email: profile.email,
      phone: profile.phone,
    };
  }
}
