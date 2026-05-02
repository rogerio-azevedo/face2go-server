import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import type { FeatureSlug } from '../common/features.constants';
import * as clientsQueries from '../database/queries/clients.queries';
import * as registrationsQueries from '../database/queries/registrations.queries';
import { DatabaseService } from '../database/database.service';
import { PermissionsService } from '../permissions/permissions.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { zodFirstMessage } from '../validation/zod-utils';

const listQuerySchema = z.object({
  status: z.enum(['draft', 'approved', 'rejected']).optional(),
});

const rejectBodySchema = z.object({
  notes: z.string().max(2000).optional().nullable(),
});

@Injectable()
export class RegistrationsAdminService {
  constructor(
    private readonly database: DatabaseService,
    private readonly permissionsService: PermissionsService,
    private readonly r2: R2StorageService,
  ) {}

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

  private mapRow(row: registrationsQueries.RegistrationRow) {
    return {
      id: row.id,
      clientId: row.clientId,
      registrationLinkId: row.registrationLinkId,
      name: row.name,
      document: row.document,
      phone: row.phone,
      email: row.email,
      additionalData: row.additionalData,
      status: row.status,
      submittedAt: row.submittedAt,
      approvedAt: row.approvedAt,
      rejectionNotes: row.rejectionNotes,
      createdAt: row.createdAt,
      hasFacePhoto: Boolean(row.faceImageKey),
    };
  }

  async listForCompanyUser(
    user: JwtPayload,
    clientId: string,
    query: Record<string, string | undefined>,
  ) {
    await this.ensureCompanyCanAccessClient(user, clientId);
    const parsed = listQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const rows = await registrationsQueries.listSubmittedRegistrationsForClient(
      this.database.db,
      clientId,
      parsed.data.status,
    );
    return rows.map((r) => this.mapRow(r));
  }

  async listForClientTenant(
    user: JwtPayload,
    query: Record<string, string | undefined>,
  ) {
    const clientId = this.ensureClientTenant(user);
    const parsed = listQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const rows = await registrationsQueries.listSubmittedRegistrationsForClient(
      this.database.db,
      clientId,
      parsed.data.status,
    );
    return rows.map((r) => this.mapRow(r));
  }

  async faceUrlForCompanyUser(
    user: JwtPayload,
    clientId: string,
    registrationId: string,
  ) {
    await this.ensureCompanyCanAccessClient(user, clientId);
    return this.faceUrlShared(clientId, registrationId);
  }

  async faceUrlForClientTenant(
    user: JwtPayload,
    registrationId: string,
  ) {
    const clientId = this.ensureClientTenant(user);
    return this.faceUrlShared(clientId, registrationId);
  }

  private async faceUrlShared(clientId: string, registrationId: string) {
    const row = await registrationsQueries.getRegistrationByIdForClient(
      this.database.db,
      registrationId,
      clientId,
    );
    if (!row?.faceImageKey) {
      throw new NotFoundException('Cadastro ou foto não encontrada.');
    }
    const url = await this.r2.createPresignedGetUrl(row.faceImageKey);
    return { url, expiresInSeconds: 60 * 60 };
  }

  async approveForCompanyUser(
    user: JwtPayload,
    clientId: string,
    registrationId: string,
  ) {
    await this.ensureCompanyCanAccessClient(user, clientId);
    return this.approveShared(clientId, registrationId, user.sub);
  }

  async approveForClientTenant(user: JwtPayload, registrationId: string) {
    const clientId = this.ensureClientTenant(user);
    return this.approveShared(clientId, registrationId, user.sub);
  }

  private async approveShared(
    clientId: string,
    registrationId: string,
    decidedByUserId: string,
  ) {
    const updated = await registrationsQueries.approveRegistration(
      this.database.db,
      registrationId,
      clientId,
      decidedByUserId,
    );
    if (!updated) {
      throw new NotFoundException(
        'Cadastro não encontrado ou já foi processado.',
      );
    }
    return this.mapRow(updated);
  }

  async rejectForCompanyUser(
    user: JwtPayload,
    clientId: string,
    registrationId: string,
    body: unknown,
  ) {
    await this.ensureCompanyCanAccessClient(user, clientId);
    return this.rejectShared(clientId, registrationId, user.sub, body);
  }

  async rejectForClientTenant(
    user: JwtPayload,
    registrationId: string,
    body: unknown,
  ) {
    const clientId = this.ensureClientTenant(user);
    return this.rejectShared(clientId, registrationId, user.sub, body);
  }

  private async rejectShared(
    clientId: string,
    registrationId: string,
    decidedByUserId: string,
    body: unknown,
  ) {
    const parsed = rejectBodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const updated = await registrationsQueries.rejectRegistration(
      this.database.db,
      registrationId,
      clientId,
      decidedByUserId,
      parsed.data.notes?.trim() ?? null,
    );
    if (!updated) {
      throw new NotFoundException(
        'Cadastro não encontrado ou já foi processado.',
      );
    }
    return this.mapRow(updated);
  }
}
