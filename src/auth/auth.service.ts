import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';

import { DatabaseService } from '../database/database.service';
import * as invitesQueries from '../database/queries/invites.queries';
import {
  clientUsers,
  companyUsers,
  users,
} from '../database/schema';
import type { JwtPayload } from './interfaces/jwt-payload.interface';
import { registerSchema } from '../validation/register.schema';
import { zodFirstMessage } from '../validation/zod-utils';

export type AuthenticatedUser = {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  companyId?: string;
  clientId?: string;
  companyUserId?: string;
  clientUserId?: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly jwtService: JwtService,
  ) {}

  private toPayload(user: AuthenticatedUser): JwtPayload {
    return {
      sub: user.id,
      email: user.email,
      name: user.name ?? null,
      role: user.role,
      companyId: user.companyId ?? null,
      clientId: user.clientId ?? null,
      companyUserId: user.companyUserId ?? null,
      clientUserId: user.clientUserId ?? null,
    };
  }

  async validateCredentials(
    email: string,
    password: string,
  ): Promise<AuthenticatedUser | null> {
    const db = this.database.db;

    const [userRow] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!userRow?.password) return null;
    if (!userRow.isActive) return null;

    const match = await bcrypt.compare(password, userRow.password);
    if (!match) return null;

    if (userRow.role === 'super_admin') {
      return {
        id: userRow.id,
        email: userRow.email,
        name: userRow.name ?? undefined,
        role: 'super_admin',
      };
    }

    const [companyLink] = await db
      .select()
      .from(companyUsers)
      .where(
        and(
          eq(companyUsers.userId, userRow.id),
          eq(companyUsers.isActive, true),
        ),
      )
      .limit(1);

    if (companyLink) {
      return {
        id: userRow.id,
        email: userRow.email,
        name: userRow.name ?? undefined,
        role: companyLink.role,
        companyId: companyLink.companyId,
        companyUserId: companyLink.id,
      };
    }

    const [clientLink] = await db
      .select()
      .from(clientUsers)
      .where(
        and(
          eq(clientUsers.userId, userRow.id),
          eq(clientUsers.isActive, true),
        ),
      )
      .limit(1);

    if (clientLink) {
      return {
        id: userRow.id,
        email: userRow.email,
        name: userRow.name ?? undefined,
        role: clientLink.role,
        clientId: clientLink.clientId,
        clientUserId: clientLink.id,
      };
    }

    if (userRow.role === 'face_user') {
      return {
        id: userRow.id,
        email: userRow.email,
        name: userRow.name ?? undefined,
        role: 'face_user',
      };
    }

    return null;
  }

  async login(email: string, password: string) {
    const user = await this.validateCredentials(email, password);
    if (!user) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }
    const payload = this.toPayload(user);
    const accessToken = await this.jwtService.signAsync(payload);
    return { accessToken, user };
  }

  async register(input: unknown): Promise<{ success: true }> {
    const parsed = registerSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const { email, password, name, phone, jobTitle, invite: code } =
      parsed.data;

    const bundle = await invitesQueries.getInviteByCode(
      this.database.db,
      code.trim(),
    );
    if (!bundle?.invite?.isActive) {
      throw new BadRequestException('Convite inválido ou inativo.');
    }

    const { invite, company } = bundle;
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      throw new BadRequestException('Convite expirado.');
    }
    if (!company?.isActive) {
      throw new BadRequestException('Empresa inativa.');
    }

    const existing = await this.database.db.query.users.findFirst({
      where: eq(users.email, email),
    });
    if (existing) {
      throw new ConflictException('E-mail já cadastrado.');
    }

    const hashed = await bcrypt.hash(password, 10);

    try {
      const userId = crypto.randomUUID();
      await this.database.db.insert(users).values({
        id: userId,
        email,
        password: hashed,
        name,
        role: 'member',
        isActive: true,
      });

      await this.database.db.insert(companyUsers).values({
        companyId: company.id,
        userId,
        role: invite.role,
        jobTitle,
        phone: phone.replace(/\D/g, '') || phone.trim(),
        isActive: true,
      });

      await invitesQueries.incrementInviteUsedCount(this.database.db, invite.id);
      return { success: true };
    } catch {
      throw new BadRequestException('Não foi possível concluir o cadastro.');
    }
  }

  profileFromPayload(payload: JwtPayload): AuthenticatedUser {
    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name ?? undefined,
      role: payload.role,
      companyId: payload.companyId ?? undefined,
      clientId: payload.clientId ?? undefined,
      companyUserId: payload.companyUserId ?? undefined,
      clientUserId: payload.clientUserId ?? undefined,
    };
  }
}
