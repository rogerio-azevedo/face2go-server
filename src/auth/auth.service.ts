import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { and, eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';

import { DatabaseService } from '../database/database.service';
import * as invitesQueries from '../database/queries/invites.queries';
import * as clientInviteLinksQueries from '../database/queries/client-invite-links.queries';
import * as clientUsersQueries from '../database/queries/client-users.queries';
import * as verificationTokensQueries from '../database/queries/verification-tokens.queries';
import {
  clients,
  clientMembers,
  clientRoles,
  clientUsers,
  companies,
  companyUsers,
  responsibles,
  users,
} from '../database/schema';
import type { JwtPayload } from './interfaces/jwt-payload.interface';
import type {
  AuthenticatedUser,
  IdentityUser,
  JoinContextResult,
  LoginResult,
  SelectContextResult,
} from './interfaces/auth-types.interface';
import type {
  SelectContextInput,
  UserContext,
} from './interfaces/user-context.interface';
import type { AuthServiceContract } from './interfaces/auth-service.interface';
import { normalizeLoginIdentifier } from './utils/auth-identifiers';
import {
  registerSchema,
  type RegisterInput,
} from '../validation/register.schema';
import { joinContextSchema } from '../validation/join-context.schema';
import { requestPasswordSchema } from '../validation/request-password.schema';
import { resetPasswordSchema } from '../validation/reset-password.schema';
import { zodFirstMessage } from '../validation/zod-utils';
import { EmailService } from '../email/email.service';

export type {
  AuthenticatedUser,
  IdentityUser,
  JoinContextResult,
  LoginResult,
  SelectContextResult,
} from './interfaces/auth-types.interface';

const IDENTITY_TOKEN_EXPIRES_IN = '5m';
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService implements AuthServiceContract {
  constructor(
    private readonly database: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
  ) {}

  private toIdentityPayload(user: IdentityUser): JwtPayload {
    return {
      sub: user.id,
      email: user.email,
      name: user.name ?? null,
      role: 'identity',
      contextType: 'identity',
      companyId: null,
      clientId: null,
      companyUserId: null,
      clientUserId: null,
      responsibleId: null,
      memberId: null,
    };
  }

  private toContextPayload(user: AuthenticatedUser): JwtPayload {
    return {
      sub: user.id,
      email: user.email,
      name: user.name ?? null,
      role: user.role,
      contextType: user.contextType ?? 'company',
      companyId: user.companyId ?? null,
      clientId: user.clientId ?? null,
      companyUserId: user.companyUserId ?? null,
      clientUserId: user.clientUserId ?? null,
      responsibleId: user.responsibleId ?? null,
      memberId: user.memberId ?? null,
    };
  }

  private async findUserByIdentifier(identifier: string) {
    const parsed = normalizeLoginIdentifier(identifier);
    const db = this.database.db;

    if (parsed.kind === 'email') {
      const [row] = await db
        .select()
        .from(users)
        .where(eq(users.email, parsed.value))
        .limit(1);
      return row;
    }

    if (parsed.value.length !== 11) {
      return null;
    }

    const [byUserCpf] = await db
      .select()
      .from(users)
      .where(eq(users.cpf, parsed.value))
      .limit(1);
    if (byUserCpf) return byUserCpf;

    const [byResponsibleDocument] = await db
      .select({ user: users })
      .from(users)
      .innerJoin(responsibles, eq(responsibles.userId, users.id))
      .where(
        and(
          eq(responsibles.isActive, true),
          sql`regexp_replace(${responsibles.document}, '[^0-9]', '', 'g') = ${parsed.value}`,
        ),
      )
      .limit(1);

    return byResponsibleDocument?.user ?? null;
  }

  async validateCredentials(
    identifier: string,
    password: string,
  ): Promise<IdentityUser | null> {
    const userRow = await this.findUserByIdentifier(identifier);
    if (!userRow?.password) return null;
    if (!userRow.isActive) return null;

    const match = await bcrypt.compare(password, userRow.password);
    if (!match) return null;

    return {
      id: userRow.id,
      email: userRow.email,
      name: userRow.name ?? undefined,
      cpf: userRow.cpf ?? undefined,
    };
  }

  async getAllContexts(userId: string): Promise<UserContext[]> {
    const db = this.database.db;
    const contexts: UserContext[] = [];

    const [userRow] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!userRow?.isActive) {
      return contexts;
    }

    if (userRow.role === 'super_admin') {
      contexts.push({
        type: 'super_admin',
        contextId: 'super_admin',
        label: 'Super administrador',
      });
    }

    const companyLinks = await db
      .select({
        companyUserId: companyUsers.id,
        companyId: companyUsers.companyId,
        role: companyUsers.role,
        companyName: companies.name,
        logoUrl: companies.logoUrl,
        companyActive: companies.isActive,
      })
      .from(companyUsers)
      .innerJoin(companies, eq(companyUsers.companyId, companies.id))
      .where(
        and(eq(companyUsers.userId, userId), eq(companyUsers.isActive, true)),
      );

    for (const link of companyLinks) {
      if (!link.companyActive) continue;
      contexts.push({
        type: 'company',
        contextId: link.companyUserId,
        companyUserId: link.companyUserId,
        companyId: link.companyId,
        companyName: link.companyName,
        logoUrl: link.logoUrl,
        role: link.role,
        label: `${link.companyName} (${link.role === 'company_admin' ? 'Admin' : 'Operador'})`,
      });
    }

    const clientLinks = await db
      .select({
        clientUserId: clientUsers.id,
        clientId: clientUsers.clientId,
        role: clientUsers.role,
        clientName: clients.name,
        companyId: clients.companyId,
        logoUrl: clients.logoUrl,
        primaryColor: clients.primaryColor,
        privacyPolicyUrl: clients.privacyPolicyUrl,
        privacyAlias: clients.privacyAlias,
        clientActive: clients.isActive,
      })
      .from(clientUsers)
      .innerJoin(clients, eq(clientUsers.clientId, clients.id))
      .where(
        and(eq(clientUsers.userId, userId), eq(clientUsers.isActive, true)),
      );

    for (const link of clientLinks) {
      if (!link.clientActive) continue;
      contexts.push({
        type: 'client',
        contextId: link.clientUserId,
        clientUserId: link.clientUserId,
        clientId: link.clientId,
        clientName: link.clientName,
        companyId: link.companyId,
        role: link.role,
        branding: {
          logoUrl: link.logoUrl,
          primaryColor: link.primaryColor,
          privacyPolicyUrl: link.privacyPolicyUrl,
          privacyAlias: link.privacyAlias,
        },
        label: `${link.clientName} (${link.role === 'client_admin' ? 'Admin' : 'Operador'})`,
      });
    }

    const responsibleLinks = await db
      .select({
        responsibleId: responsibles.id,
        clientId: responsibles.clientId,
        responsibleName: responsibles.name,
        clientName: clients.name,
        logoUrl: clients.logoUrl,
        primaryColor: clients.primaryColor,
        privacyPolicyUrl: clients.privacyPolicyUrl,
        privacyAlias: clients.privacyAlias,
        clientActive: clients.isActive,
      })
      .from(responsibles)
      .innerJoin(clients, eq(responsibles.clientId, clients.id))
      .where(
        and(eq(responsibles.userId, userId), eq(responsibles.isActive, true)),
      );

    for (const link of responsibleLinks) {
      if (!link.clientActive) continue;
      contexts.push({
        type: 'responsible',
        contextId: link.responsibleId,
        responsibleId: link.responsibleId,
        clientId: link.clientId,
        clientName: link.clientName,
        branding: {
          logoUrl: link.logoUrl,
          primaryColor: link.primaryColor,
          privacyPolicyUrl: link.privacyPolicyUrl,
          privacyAlias: link.privacyAlias,
        },
        label: `Responsável — ${link.clientName}`,
      });
    }

    const memberLinks = await db
      .select({
        memberId: clientMembers.id,
        clientId: clientMembers.clientId,
        memberName: clientMembers.name,
        roleName: clientRoles.name,
        clientName: clients.name,
        logoUrl: clients.logoUrl,
        primaryColor: clients.primaryColor,
        privacyPolicyUrl: clients.privacyPolicyUrl,
        privacyAlias: clients.privacyAlias,
        clientActive: clients.isActive,
      })
      .from(clientMembers)
      .innerJoin(clientRoles, eq(clientMembers.roleId, clientRoles.id))
      .innerJoin(clients, eq(clientMembers.clientId, clients.id))
      .where(
        and(eq(clientMembers.userId, userId), eq(clientMembers.isActive, true)),
      );

    for (const link of memberLinks) {
      if (!link.clientActive) continue;
      contexts.push({
        type: 'member',
        contextId: link.memberId,
        memberId: link.memberId,
        clientId: link.clientId,
        clientName: link.clientName,
        roleName: link.roleName,
        branding: {
          logoUrl: link.logoUrl,
          primaryColor: link.primaryColor,
          privacyPolicyUrl: link.privacyPolicyUrl,
          privacyAlias: link.privacyAlias,
        },
        label: `${link.roleName} — ${link.clientName}`,
      });
    }

    if (userRow.role === 'face_user') {
      contexts.push({
        type: 'face_user',
        contextId: 'face_user',
        label: 'Usuário facial',
      });
    }

    return contexts;
  }

  private findContextMatch(
    contexts: UserContext[],
    input: SelectContextInput,
  ): UserContext | undefined {
    if (
      input.contextType === 'super_admin' ||
      input.contextType === 'face_user'
    ) {
      return contexts.find((ctx) => ctx.type === input.contextType);
    }

    if (!input.contextId) {
      return undefined;
    }

    return contexts.find(
      (ctx) =>
        ctx.type === input.contextType && ctx.contextId === input.contextId,
    );
  }

  private contextToAuthenticatedUser(
    identity: IdentityUser,
    context: UserContext,
  ): AuthenticatedUser {
    switch (context.type) {
      case 'super_admin':
        return {
          ...identity,
          role: 'super_admin',
          contextType: 'super_admin',
        };
      case 'company':
        return {
          ...identity,
          role: context.role,
          contextType: 'company',
          companyId: context.companyId,
          companyUserId: context.companyUserId,
        };
      case 'client':
        return {
          ...identity,
          role: context.role,
          contextType: 'client',
          clientId: context.clientId,
          clientUserId: context.clientUserId,
          companyId: context.companyId,
        };
      case 'responsible':
        return {
          ...identity,
          role: 'responsible',
          contextType: 'responsible',
          clientId: context.clientId,
          responsibleId: context.responsibleId,
        };
      case 'member':
        return {
          ...identity,
          role: 'member',
          contextType: 'member',
          clientId: context.clientId,
          memberId: context.memberId,
        };
      case 'face_user':
        return {
          ...identity,
          role: 'face_user',
          contextType: 'face_user',
        };
    }
  }

  async login(identifier: string, password: string): Promise<LoginResult> {
    const user = await this.validateCredentials(identifier, password);
    if (!user) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const contexts = await this.getAllContexts(user.id);
    if (contexts.length === 0) {
      throw new UnauthorizedException('Usuário sem contextos de acesso.');
    }

    const identityToken = await this.jwtService.signAsync(
      this.toIdentityPayload(user),
      { expiresIn: IDENTITY_TOKEN_EXPIRES_IN },
    );

    return { user, contexts, identityToken };
  }

  async selectContext(
    userId: string,
    input: SelectContextInput,
  ): Promise<SelectContextResult> {
    const [userRow] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!userRow?.isActive) {
      throw new UnauthorizedException('Usuário inativo.');
    }

    const identity: IdentityUser = {
      id: userRow.id,
      email: userRow.email,
      name: userRow.name ?? undefined,
      cpf: userRow.cpf ?? undefined,
    };

    const contexts = await this.getAllContexts(userId);
    const matched = this.findContextMatch(contexts, input);
    if (!matched) {
      throw new BadRequestException('Contexto inválido ou indisponível.');
    }

    const authenticated = this.contextToAuthenticatedUser(identity, matched);
    const payload = this.toContextPayload(authenticated);
    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      context: matched,
      user: authenticated,
    };
  }

  async joinContext(input: unknown): Promise<JoinContextResult> {
    const parsed = joinContextSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const user = await this.validateCredentials(
      parsed.data.identifier,
      parsed.data.password,
    );
    if (!user) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const [userRow] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    if (!userRow) {
      throw new UnauthorizedException('Usuário não encontrado.');
    }

    const trimmedCode = parsed.data.invite.trim();
    const linkData: RegisterInput = {
      email: user.email,
      password: parsed.data.password,
      name: user.name ?? '',
      invite: trimmedCode,
    };

    const companyBundle = await invitesQueries.getInviteByCode(
      this.database.db,
      trimmedCode,
    );

    if (companyBundle?.invite?.isActive) {
      await this.applyCompanyInviteToExistingUser(
        userRow,
        linkData,
        companyBundle,
      );
    } else {
      const clientBundle = await clientInviteLinksQueries.getClientInviteByCode(
        this.database.db,
        trimmedCode,
      );

      if (!clientBundle?.invite?.isActive) {
        throw new BadRequestException('Convite inválido ou inativo.');
      }

      await this.applyClientInviteToExistingUser(
        userRow,
        linkData,
        clientBundle,
      );
    }

    const contexts = await this.getAllContexts(user.id);
    if (contexts.length === 0) {
      throw new UnauthorizedException('Usuário sem contextos de acesso.');
    }

    const identityToken = await this.jwtService.signAsync(
      this.toIdentityPayload(user),
      { expiresIn: IDENTITY_TOKEN_EXPIRES_IN },
    );

    return { user, contexts, identityToken };
  }

  private async applyCompanyInviteToExistingUser(
    existing: typeof users.$inferSelect,
    data: RegisterInput,
    bundle: NonNullable<
      Awaited<ReturnType<typeof invitesQueries.getInviteByCode>>
    >,
  ): Promise<void> {
    const { invite, company } = bundle;
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      throw new BadRequestException('Convite expirado.');
    }
    if (!company?.isActive) {
      throw new BadRequestException('Empresa inativa.');
    }

    await this.linkExistingUserToCompany(existing, data, invite, company.id);
  }

  private async applyClientInviteToExistingUser(
    existing: typeof users.$inferSelect,
    data: RegisterInput,
    bundle: NonNullable<
      Awaited<ReturnType<typeof clientInviteLinksQueries.getClientInviteByCode>>
    >,
  ): Promise<void> {
    const { invite, client, company } = bundle;
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      throw new BadRequestException('Convite expirado.');
    }
    if (!client?.isActive) {
      throw new BadRequestException('Cliente inativo.');
    }
    if (!company?.isActive) {
      throw new BadRequestException('Empresa inativa.');
    }

    await this.linkExistingUserToClient(existing, data, invite, client.id);
  }

  async register(input: unknown): Promise<{ success: true }> {
    const parsed = registerSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const trimmedCode = parsed.data.invite.trim();
    const companyBundle = await invitesQueries.getInviteByCode(
      this.database.db,
      trimmedCode,
    );

    if (companyBundle?.invite?.isActive) {
      return this.registerWithCompanyInvite(parsed.data, companyBundle);
    }

    const clientBundle = await clientInviteLinksQueries.getClientInviteByCode(
      this.database.db,
      trimmedCode,
    );

    if (clientBundle?.invite?.isActive) {
      return this.registerWithClientInvite(parsed.data, clientBundle);
    }

    throw new BadRequestException('Convite inválido ou inativo.');
  }

  private async registerWithCompanyInvite(
    data: RegisterInput,
    bundle: NonNullable<
      Awaited<ReturnType<typeof invitesQueries.getInviteByCode>>
    >,
  ): Promise<{ success: true }> {
    const { invite, company } = bundle;
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      throw new BadRequestException('Convite expirado.');
    }
    if (!company?.isActive) {
      throw new BadRequestException('Empresa inativa.');
    }

    const existing = await this.database.db.query.users.findFirst({
      where: eq(users.email, data.email),
    });

    if (existing) {
      return this.linkExistingUserToCompany(existing, data, invite, company.id);
    }

    if (!data.phone?.trim() || !data.jobTitle?.trim()) {
      throw new BadRequestException(
        'Telefone e cargo são obrigatórios para novos cadastros na empresa.',
      );
    }

    const hashed = await bcrypt.hash(data.password, 10);

    try {
      const userId = crypto.randomUUID();
      await this.database.db.insert(users).values({
        id: userId,
        email: data.email,
        password: hashed,
        name: data.name,
        role: 'member',
        isActive: true,
      });

      await this.database.db.insert(companyUsers).values({
        companyId: company.id,
        userId,
        role: invite.role,
        jobTitle: data.jobTitle,
        phone: data.phone.replace(/\D/g, '') || data.phone.trim(),
        isActive: true,
      });

      await invitesQueries.incrementInviteUsedCount(
        this.database.db,
        invite.id,
      );
      return { success: true };
    } catch {
      throw new BadRequestException('Não foi possível concluir o cadastro.');
    }
  }

  private async registerWithClientInvite(
    data: RegisterInput,
    bundle: NonNullable<
      Awaited<ReturnType<typeof clientInviteLinksQueries.getClientInviteByCode>>
    >,
  ): Promise<{ success: true }> {
    const { invite, client, company } = bundle;
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      throw new BadRequestException('Convite expirado.');
    }
    if (!client?.isActive) {
      throw new BadRequestException('Cliente inativo.');
    }
    if (!company?.isActive) {
      throw new BadRequestException('Empresa inativa.');
    }

    const existing = await this.database.db.query.users.findFirst({
      where: eq(users.email, data.email),
    });

    if (existing) {
      return this.linkExistingUserToClient(existing, data, invite, client.id);
    }

    const hashed = await bcrypt.hash(data.password, 10);

    try {
      const userId = crypto.randomUUID();
      await this.database.db.insert(users).values({
        id: userId,
        email: data.email,
        password: hashed,
        name: data.name,
        role: 'member',
        isActive: true,
      });

      await this.database.db.insert(clientUsers).values({
        clientId: client.id,
        userId,
        role: invite.role,
        isActive: true,
      });

      await clientInviteLinksQueries.incrementClientInviteUsedCount(
        this.database.db,
        invite.id,
      );
      return { success: true };
    } catch {
      throw new BadRequestException('Não foi possível concluir o cadastro.');
    }
  }

  private async linkExistingUserToCompany(
    existing: typeof users.$inferSelect,
    data: RegisterInput,
    invite: { id: string; role: 'company_admin' | 'company_operator' },
    companyId: string,
  ): Promise<{ success: true }> {
    if (!existing.password) {
      throw new BadRequestException('Usuário existente sem senha configurada.');
    }
    if (!existing.isActive) {
      throw new BadRequestException('Usuário inativo.');
    }

    const passwordMatch = await bcrypt.compare(
      data.password,
      existing.password,
    );
    if (!passwordMatch) {
      throw new UnauthorizedException(
        'Senha incorreta para o usuário existente.',
      );
    }

    const currentLink = await clientUsersQueries.getCompanyUserLink(
      this.database.db,
      existing.id,
      companyId,
    );
    if (currentLink) {
      throw new BadRequestException('Usuário já vinculado a esta empresa.');
    }

    if (data.name?.trim()) {
      await this.database.db
        .update(users)
        .set({ name: data.name.trim() })
        .where(eq(users.id, existing.id));
    }

    await this.database.db.insert(companyUsers).values({
      companyId,
      userId: existing.id,
      role: invite.role,
      jobTitle: data.jobTitle?.trim() || null,
      phone: data.phone
        ? data.phone.replace(/\D/g, '') || data.phone.trim()
        : null,
      isActive: true,
    });

    await invitesQueries.incrementInviteUsedCount(this.database.db, invite.id);
    return { success: true };
  }

  private async linkExistingUserToClient(
    existing: typeof users.$inferSelect,
    data: RegisterInput,
    invite: { id: string; role: 'client_admin' | 'client_operator' },
    clientId: string,
  ): Promise<{ success: true }> {
    if (!existing.password) {
      throw new BadRequestException('Usuário existente sem senha configurada.');
    }
    if (!existing.isActive) {
      throw new BadRequestException('Usuário inativo.');
    }

    const passwordMatch = await bcrypt.compare(
      data.password,
      existing.password,
    );
    if (!passwordMatch) {
      throw new UnauthorizedException(
        'Senha incorreta para o usuário existente.',
      );
    }

    const currentLink = await clientUsersQueries.getClientUserLink(
      this.database.db,
      existing.id,
      clientId,
    );
    if (currentLink) {
      throw new BadRequestException('Usuário já vinculado a este cliente.');
    }

    if (data.name?.trim()) {
      await this.database.db
        .update(users)
        .set({ name: data.name.trim() })
        .where(eq(users.id, existing.id));
    }

    await this.database.db.insert(clientUsers).values({
      clientId,
      userId: existing.id,
      role: invite.role,
      isActive: true,
    });

    await clientInviteLinksQueries.incrementClientInviteUsedCount(
      this.database.db,
      invite.id,
    );
    return { success: true };
  }

  async requestPassword(input: unknown): Promise<{ ok: true }> {
    const parsed = requestPasswordSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const userRow = await this.findUserByIdentifier(parsed.data.identifier);
    if (userRow?.isActive && userRow.email) {
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS);

      await verificationTokensQueries.insertVerificationToken(
        this.database.db,
        userRow.email,
        token,
        expiresAt,
      );

      await this.emailService.sendPasswordResetEmail(
        userRow.email,
        userRow.name,
        token,
      );
    }

    return { ok: true };
  }

  async resetPassword(input: unknown): Promise<{ ok: true }> {
    const parsed = resetPasswordSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const row = await verificationTokensQueries.findValidVerificationToken(
      this.database.db,
      parsed.data.token,
    );
    if (!row) {
      throw new BadRequestException('Link inválido ou expirado.');
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    await this.database.db
      .update(users)
      .set({ password: passwordHash })
      .where(eq(users.email, row.identifier));

    await verificationTokensQueries.deleteVerificationToken(
      this.database.db,
      row.identifier,
      row.token,
    );

    return { ok: true };
  }

  profileFromPayload(payload: JwtPayload): AuthenticatedUser {
    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name ?? undefined,
      role: payload.role,
      contextType: payload.contextType,
      companyId: payload.companyId ?? undefined,
      clientId: payload.clientId ?? undefined,
      companyUserId: payload.companyUserId ?? undefined,
      clientUserId: payload.clientUserId ?? undefined,
      responsibleId: payload.responsibleId ?? undefined,
      memberId: payload.memberId ?? undefined,
    };
  }
}
