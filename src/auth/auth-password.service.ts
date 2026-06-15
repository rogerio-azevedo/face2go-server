import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';

import { DatabaseService } from '../database/database.service';
import * as verificationTokensQueries from '../database/queries/verification-tokens.queries';
import { users } from '../database/schema';
import { EmailService } from '../email/email.service';
import type { RequestPasswordInput } from '../validation/request-password.schema';
import type { ResetPasswordInput } from '../validation/reset-password.schema';
import { normalizeLoginIdentifier } from './utils/auth-identifiers';

const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthPasswordService {
  constructor(
    private readonly database: DatabaseService,
    private readonly emailService: EmailService,
  ) {}

  async findUserByIdentifier(identifier: string) {
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
    return byUserCpf ?? null;
  }

  async requestPassword(input: RequestPasswordInput): Promise<{ ok: true }> {
    const userRow = await this.findUserByIdentifier(input.identifier);
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

  async resetPassword(input: ResetPasswordInput): Promise<{ ok: true }> {
    const row = await verificationTokensQueries.findValidVerificationToken(
      this.database.db,
      input.token,
    );
    if (!row) {
      throw new BadRequestException('Link inválido ou expirado.');
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
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

  async validateCredentials(identifier: string, password: string) {
    const userRow = await this.findUserByIdentifier(identifier);
    if (!userRow?.password || !userRow.isActive) {
      return null;
    }

    const match = await bcrypt.compare(password, userRow.password);
    if (!match) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    return {
      id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      role: userRow.role,
    };
  }
}
