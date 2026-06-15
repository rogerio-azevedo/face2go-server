import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DatabaseService } from '../database/database.service';
import * as clientsQueries from '../database/queries/clients.queries';
import * as clientDisplayDevicesQueries from '../database/queries/client-display-devices.queries';
import * as clientInviteLinksQueries from '../database/queries/client-invite-links.queries';
import * as clientUsersQueries from '../database/queries/client-users.queries';
import * as membersQueries from '../database/queries/members.queries';
import { PermissionsService } from '../permissions/permissions.service';
import {
  createClientSchema,
  updateClientSchema,
} from '../validation/clients.schema';
import { generateClientInviteSchema } from '../validation/client-invites.schema';
import { setClientDisplayDevicesSchema } from '../validation/client-display-devices.schema';
import { zodFirstMessage } from '../validation/zod-utils';

const toggleActiveSchema = z.object({
  isActive: z.boolean(),
});

@Injectable()
export class ClientsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly permissionsService: PermissionsService,
  ) {}

  private ensureCompany(user: JwtPayload): string {
    const companyId = user.companyId ?? undefined;
    if (!companyId) {
      throw new ForbiddenException('Sem permissão.');
    }
    return companyId;
  }

  private omitDisplayToken<
    T extends { displayToken?: unknown; displayShortCode?: unknown },
  >(row: T): Omit<T, 'displayToken' | 'displayShortCode'> {
    const { displayToken, displayShortCode, ...rest } = row;
    void displayToken;
    void displayShortCode;
    return rest;
  }

  /** Garante leitura do cliente (admin empresa ou operador com `clients` + can_read). */
  private async assertReadAccessToClient(
    user: JwtPayload,
    clientId: string,
  ): Promise<string> {
    const companyId = this.ensureCompany(user);
    if (user.role === 'company_admin') {
      const row = await clientsQueries.getClientById(
        this.database.db,
        clientId,
        companyId,
      );
      if (!row) {
        throw new NotFoundException('Cliente não encontrado.');
      }
      return companyId;
    }
    if (user.role === 'company_operator') {
      const ok = await this.permissionsService.evaluateCompanyFeatureAction(
        user.role,
        user.companyUserId,
        'clients',
        'can_read',
      );
      if (!ok) {
        throw new ForbiddenException('Sem permissão.');
      }
      const row = await clientsQueries.getClientById(
        this.database.db,
        clientId,
        companyId,
      );
      if (!row) {
        throw new NotFoundException('Cliente não encontrado.');
      }
      return companyId;
    }
    throw new ForbiddenException('Sem permissão.');
  }

  /** Detalhe de um cliente (admin ou operador com `clients` + can_read). */
  async getById(user: JwtPayload, clientId: string) {
    const companyId = await this.assertReadAccessToClient(user, clientId);
    const row = await clientsQueries.getClientById(
      this.database.db,
      clientId,
      companyId,
    );
    if (!row) {
      throw new NotFoundException('Cliente não encontrado.');
    }
    const safe = this.omitDisplayToken(row);
    return {
      ...safe,
      type: row.type ?? 'other',
    };
  }

  /** Lista clientes (admin ou operador com `clients` + can_read). */
  async list(user: JwtPayload) {
    const companyId = this.ensureCompany(user);
    if (user.role === 'company_admin') {
      return clientsQueries.listClients(this.database.db, companyId);
    }
    if (user.role === 'company_operator') {
      const ok = await this.permissionsService.evaluateCompanyFeatureAction(
        user.role,
        user.companyUserId,
        'clients',
        'can_read',
      );
      if (!ok) {
        throw new ForbiddenException('Sem permissão.');
      }
      return clientsQueries.listClients(this.database.db, companyId);
    }
    throw new ForbiddenException('Sem permissão.');
  }

  /** Token e código curto do display público TV. */
  async ensureTvDisplayToken(user: JwtPayload, clientId: string) {
    const companyId = await this.assertReadAccessToClient(user, clientId);
    const result = await clientsQueries.ensureDisplayTokenForCompanyClient(
      this.database.db,
      clientId,
      companyId,
    );
    if (!result) {
      throw new NotFoundException('Cliente não encontrado.');
    }
    const short = await clientsQueries.ensureDisplayShortCodeForCompanyClient(
      this.database.db,
      clientId,
      companyId,
    );
    if (!short) {
      throw new NotFoundException('Cliente não encontrado.');
    }
    return { token: result.token, shortCode: short.shortCode };
  }

  /** Garante apenas o código curto (token já deve existir ou será criado). */
  async ensureTvDisplayShortCode(user: JwtPayload, clientId: string) {
    const companyId = await this.assertReadAccessToClient(user, clientId);
    const tokenOk = await clientsQueries.ensureDisplayTokenForCompanyClient(
      this.database.db,
      clientId,
      companyId,
    );
    if (!tokenOk) {
      throw new NotFoundException('Cliente não encontrado.');
    }
    const short = await clientsQueries.ensureDisplayShortCodeForCompanyClient(
      this.database.db,
      clientId,
      companyId,
    );
    if (!short) {
      throw new NotFoundException('Cliente não encontrado.');
    }
    return { shortCode: short.shortCode };
  }

  /** Troca o token — invalida URLs antigas. */
  async regenerateTvDisplayToken(user: JwtPayload, clientId: string) {
    const companyId = await this.assertReadAccessToClient(user, clientId);
    const result = await clientsQueries.regenerateDisplayTokenForCompanyClient(
      this.database.db,
      clientId,
      companyId,
    );
    if (!result) {
      throw new NotFoundException('Cliente não encontrado.');
    }
    const short = await clientsQueries.ensureDisplayShortCodeForCompanyClient(
      this.database.db,
      clientId,
      companyId,
    );
    if (!short) {
      throw new NotFoundException('Cliente não encontrado.');
    }
    return { token: result.token, shortCode: short.shortCode };
  }

  /** Lista câmeras LPR e leitores faciais com flag de habilitação no display. */
  async getDisplayDevices(user: JwtPayload, clientId: string) {
    await this.assertReadAccessToClient(user, clientId);
    return clientDisplayDevicesQueries.getDisplayDevicesForClient(
      this.database.db,
      clientId,
    );
  }

  /** Substitui a lista de dispositivos que alimentam o display TV. */
  async setDisplayDevices(user: JwtPayload, clientId: string, body: unknown) {
    await this.assertReadAccessToClient(user, clientId);

    const parsed = setClientDisplayDevicesSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const devices = parsed.data.devices;
    const uniqueKeys = new Set(
      devices.map((d) => `${d.deviceType}:${d.deviceId}`),
    );
    if (uniqueKeys.size !== devices.length) {
      throw new BadRequestException('Dispositivos duplicados na lista.');
    }

    const valid =
      await clientDisplayDevicesQueries.validateDisplayDevicesForClient(
        this.database.db,
        clientId,
        devices,
      );
    if (!valid) {
      throw new BadRequestException(
        'Um ou mais dispositivos não pertencem a este cliente.',
      );
    }

    await clientDisplayDevicesQueries.setDisplayDevices(
      this.database.db,
      clientId,
      devices,
    );

    return clientDisplayDevicesQueries.getDisplayDevicesForClient(
      this.database.db,
      clientId,
    );
  }

  /** Escrita: apenas company_admin (comportamento atual do Next.js). */
  async create(user: JwtPayload, body: unknown) {
    if (user.role !== 'company_admin') {
      throw new ForbiddenException('Sem permissão.');
    }
    const companyId = this.ensureCompany(user);
    const parsed = createClientSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const created = await clientsQueries.createClient(this.database.db, {
      companyId,
      name: parsed.data.name,
      type: parsed.data.type,
      cnpj: parsed.data.cnpj,
      phone: parsed.data.phone,
      email: parsed.data.email,
      logoUrl: parsed.data.logoUrl,
      primaryColor: parsed.data.primaryColor,
      privacyPolicyUrl: parsed.data.privacyPolicyUrl,
      privacyAlias: parsed.data.privacyAlias,
      timezoneOffsetMinutes: parsed.data.timezoneOffsetMinutes,
      isActive: parsed.data.isActive,
    });
    await membersQueries.seedDefaultRolesForClient(
      this.database.db,
      created.id,
      created.type,
    );
    return this.omitDisplayToken(created);
  }

  async update(user: JwtPayload, clientId: string, body: unknown) {
    if (user.role !== 'company_admin') {
      throw new ForbiddenException('Sem permissão.');
    }
    const companyId = this.ensureCompany(user);
    const parsed = updateClientSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;
    if (
      d.name === undefined &&
      d.type === undefined &&
      d.cnpj === undefined &&
      d.phone === undefined &&
      d.email === undefined &&
      d.logoUrl === undefined &&
      d.primaryColor === undefined &&
      d.privacyPolicyUrl === undefined &&
      d.privacyAlias === undefined &&
      d.timezoneOffsetMinutes === undefined &&
      d.isActive === undefined &&
      d.ienhFilialCode === undefined
    ) {
      throw new BadRequestException('Nada para atualizar.');
    }
    if (d.ienhFilialCode !== undefined && d.ienhFilialCode !== null) {
      await clientsQueries.clearIenhFilialCodeFromOtherClients(
        this.database.db,
        companyId,
        d.ienhFilialCode,
        clientId,
      );
    }
    const updated = await clientsQueries.updateClient(
      this.database.db,
      clientId,
      companyId,
      {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.type !== undefined ? { type: d.type } : {}),
        ...(d.cnpj !== undefined ? { cnpj: d.cnpj } : {}),
        ...(d.phone !== undefined ? { phone: d.phone } : {}),
        ...(d.email !== undefined ? { email: d.email } : {}),
        ...(d.logoUrl !== undefined ? { logoUrl: d.logoUrl } : {}),
        ...(d.primaryColor !== undefined
          ? { primaryColor: d.primaryColor }
          : {}),
        ...(d.privacyPolicyUrl !== undefined
          ? { privacyPolicyUrl: d.privacyPolicyUrl }
          : {}),
        ...(d.privacyAlias !== undefined
          ? { privacyAlias: d.privacyAlias }
          : {}),
        ...(d.timezoneOffsetMinutes !== undefined
          ? { timezoneOffsetMinutes: d.timezoneOffsetMinutes }
          : {}),
        ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
        ...(d.ienhFilialCode !== undefined
          ? { ienhFilialCode: d.ienhFilialCode }
          : {}),
      },
    );
    if (!updated) throw new NotFoundException('Cliente não encontrado.');
    return this.omitDisplayToken(updated);
  }

  async setActive(user: JwtPayload, clientId: string, body: unknown) {
    if (user.role !== 'company_admin') {
      throw new ForbiddenException('Sem permissão.');
    }
    const companyId = this.ensureCompany(user);
    const parsed = toggleActiveSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const existing = await clientsQueries.getClientById(
      this.database.db,
      clientId,
      companyId,
    );
    if (!existing) throw new NotFoundException('Cliente não encontrado.');
    const row = await clientsQueries.setClientActive(
      this.database.db,
      clientId,
      companyId,
      parsed.data.isActive,
    );
    if (!row) throw new NotFoundException('Cliente não encontrado.');
    return this.omitDisplayToken(row);
  }

  async listClientUsers(user: JwtPayload, clientId: string) {
    await this.assertReadAccessToClient(user, clientId);
    const usersList = await clientUsersQueries.listClientUsers(
      this.database.db,
      clientId,
    );
    return { users: usersList };
  }

  async listClientInviteLinks(user: JwtPayload, clientId: string) {
    await this.assertReadAccessToClient(user, clientId);
    const invites = await clientInviteLinksQueries.listClientInvites(
      this.database.db,
      clientId,
    );
    return { invites };
  }

  async generateClientInviteLink(
    user: JwtPayload,
    clientId: string,
    body: unknown,
  ) {
    const companyId = await this.assertReadAccessToClient(user, clientId);
    const parsed = generateClientInviteSchema.safeParse({
      clientId,
      ...(typeof body === 'object' && body !== null ? body : {}),
    });
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const client = await clientsQueries.getClientById(
      this.database.db,
      clientId,
      companyId,
    );
    if (!client) throw new NotFoundException('Cliente não encontrado.');
    if (!client.isActive) {
      throw new BadRequestException('Cliente inativo.');
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
}
