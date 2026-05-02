import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import type { FeatureSlug } from '../common/features.constants';
import * as clientsQueries from '../database/queries/clients.queries';
import * as registrationsQueries from '../database/queries/registrations.queries';
import { DatabaseService } from '../database/database.service';
import { PermissionsService } from '../permissions/permissions.service';
import { zodFirstMessage } from '../validation/zod-utils';

const createLinkSchema = z
  .object({
    kind: z.enum(['permanent', 'temporary']).default('permanent'),
    validFrom: z.coerce.date().optional(),
    validUntil: z.coerce.date().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.kind !== 'temporary') return;
    if (!val.validFrom) {
      ctx.addIssue({
        code: 'custom',
        message: 'Informe a data inicial da vigência.',
        path: ['validFrom'],
      });
    }
    if (!val.validUntil) {
      ctx.addIssue({
        code: 'custom',
        message: 'Informe a data final da vigência.',
        path: ['validUntil'],
      });
    }
    if (
      val.validFrom &&
      val.validUntil &&
      val.validFrom.getTime() > val.validUntil.getTime()
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'A data final deve ser igual ou posterior à inicial.',
        path: ['validUntil'],
      });
    }
  });

type CreateLinkSchedule =
  | { kind: 'permanent' }
  | { kind: 'temporary'; validFrom: Date; validUntil: Date };

function parseCreateLinkBody(body: unknown): CreateLinkSchedule {
  const raw =
    body === null || body === undefined || typeof body !== 'object'
      ? {}
      : (body as Record<string, unknown>);
  const withDefault =
    'kind' in raw && (raw.kind === 'permanent' || raw.kind === 'temporary')
      ? raw
      : { ...raw, kind: 'permanent' as const };
  const parsed = createLinkSchema.safeParse(withDefault);
  if (!parsed.success) {
    throw new BadRequestException(zodFirstMessage(parsed.error));
  }
  const d = parsed.data;
  if (d.kind === 'permanent') {
    return { kind: 'permanent' };
  }
  return {
    kind: 'temporary',
    validFrom: d.validFrom!,
    validUntil: d.validUntil!,
  };
}

const patchLinkSchema = z.object({
  isActive: z.boolean(),
});

function randomLinkCode(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

@Injectable()
export class RegistrationLinksService {
  constructor(
    private readonly database: DatabaseService,
    private readonly permissionsService: PermissionsService,
    private readonly configService: ConfigService,
  ) {}

  private frontendCadastroUrl(code: string): string {
    const base = this.configService.get<string>('FRONTEND_URL') ?? '';
    const trimmed = base.replace(/\/$/, '');
    return `${trimmed}/cadastro/${code}`;
  }

  private ensureCompany(user: JwtPayload): string {
    const companyId = user.companyId ?? undefined;
    if (!companyId) {
      throw new ForbiddenException('Sem permissão.');
    }
    return companyId;
  }

  private async ensureCompanyCanAccessClient(
    user: JwtPayload,
    clientId: string,
  ) {
    const companyId = this.ensureCompany(user);
    if (user.role === 'company_admin') {
      const client = await clientsQueries.getClientById(
        this.database.db,
        clientId,
        companyId,
      );
      if (!client) throw new NotFoundException('Cliente não encontrado.');
      return client;
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
      const client = await clientsQueries.getClientById(
        this.database.db,
        clientId,
        companyId,
      );
      if (!client) throw new NotFoundException('Cliente não encontrado.');
      return client;
    }
    throw new ForbiddenException('Sem permissão.');
  }

  private ensureClientTenant(user: JwtPayload): string {
    const clientId = user.clientId ?? undefined;
    if (
      !clientId ||
      (user.role !== 'client_admin' && user.role !== 'client_operator')
    ) {
      throw new ForbiddenException('Sem permissão.');
    }
    return clientId;
  }

  async createForCompanyUser(user: JwtPayload, clientId: string, body: unknown) {
    await this.ensureCompanyCanAccessClient(user, clientId);
    const schedule = parseCreateLinkBody(body);
    return this.createLink(clientId, user.sub, schedule);
  }

  async listForCompanyUser(user: JwtPayload, clientId: string) {
    await this.ensureCompanyCanAccessClient(user, clientId);
    return this.listForClientId(clientId);
  }

  async setActiveForCompanyUser(
    user: JwtPayload,
    clientId: string,
    linkId: string,
    body: unknown,
  ) {
    await this.ensureCompanyCanAccessClient(user, clientId);
    return this.setActiveShared(clientId, linkId, body);
  }

  async createForClientTenant(user: JwtPayload, body: unknown) {
    const clientId = this.ensureClientTenant(user);
    const schedule = parseCreateLinkBody(body);
    return this.createLink(clientId, user.sub, schedule);
  }

  async listForClientTenant(user: JwtPayload) {
    const clientId = this.ensureClientTenant(user);
    return this.listForClientId(clientId);
  }

  async setActiveForClientTenant(
    user: JwtPayload,
    linkId: string,
    body: unknown,
  ) {
    const clientId = this.ensureClientTenant(user);
    return this.setActiveShared(clientId, linkId, body);
  }

  private async createLink(
    clientId: string,
    createdByUserId: string,
    schedule: CreateLinkSchedule,
  ) {
    const validFrom =
      schedule.kind === 'temporary' ? schedule.validFrom : null;
    const expiresAt =
      schedule.kind === 'temporary' ? schedule.validUntil : null;
    const db = this.database.db;
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = randomLinkCode();
      try {
        const row = await registrationsQueries.insertRegistrationLink(db, {
          clientId,
          createdByUserId,
          code,
          validFrom,
          expiresAt,
        });
        return {
          id: row.id,
          code: row.code,
          isActive: row.isActive,
          validFrom: row.validFrom,
          expiresAt: row.expiresAt,
          createdAt: row.createdAt,
          registrationUrl: this.frontendCadastroUrl(row.code),
        };
      } catch {
        // colisão de code → tentar de novo
      }
    }
    throw new BadRequestException('Não foi possível gerar o link. Tente novamente.');
  }

  private async listForClientId(clientId: string) {
    const rows = await registrationsQueries.listRegistrationLinksByClient(
      this.database.db,
      clientId,
    );
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      isActive: r.isActive,
      validFrom: r.validFrom,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
      registrationUrl: this.frontendCadastroUrl(r.code),
    }));
  }

  private async setActiveShared(
    clientId: string,
    linkId: string,
    body: unknown,
  ) {
    const parsed = patchLinkSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const updated = await registrationsQueries.setRegistrationLinkActive(
      this.database.db,
      linkId,
      clientId,
      parsed.data.isActive,
    );
    if (!updated) throw new NotFoundException('Link não encontrado.');
    return {
      id: updated.id,
      code: updated.code,
      isActive: updated.isActive,
      validFrom: updated.validFrom,
      expiresAt: updated.expiresAt,
      createdAt: updated.createdAt,
      registrationUrl: this.frontendCadastroUrl(updated.code),
    };
  }
}
