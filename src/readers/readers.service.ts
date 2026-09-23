import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { createReaderCredentialsCipher } from '../common/crypto/reader-credentials.cipher';
import type { EnvVars } from '../config/env.validation';
import { DatabaseService } from '../database/database.service';
import * as clientsQueries from '../database/queries/clients.queries';
import * as readersQueries from '../database/queries/readers.queries';
import { persistBirthDateRequiredForClient } from '../registrations/registration-fields-resolve';
import { FaceListenerService } from '../face-listener/face-listener.service';
import { FaceSyncService } from '../face-sync/face-sync.service';
import {
  IntelbrasPushProvisionService,
  type IntelbrasPushMode,
} from '../intelbras-push/intelbras-push.provision.service';
import { PermissionsService } from '../permissions/permissions.service';
import {
  createReaderSchema,
  updateReaderSchema,
} from '../validation/readers.schema';
import { zodFirstMessage } from '../validation/zod-utils';

const toggleActiveSchema = z.object({
  isActive: z.boolean(),
});

/** Device ID do registro automático: o UUID do leitor sem hífen. */
function autoRegisterDeviceIdFromReader(readerId: string): string {
  return readerId.replaceAll('-', '');
}

@Injectable()
export class ReadersService {
  private readonly log = new Logger(ReadersService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly permissionsService: PermissionsService,
    private readonly faceListener: FaceListenerService,
    private readonly configService: ConfigService<EnvVars, true>,
    private readonly intelbrasPushProvision: IntelbrasPushProvisionService,
    private readonly faceSync: FaceSyncService,
  ) {}

  private async ensureBirthDateRequired(clientId: string) {
    const client = await clientsQueries.getClientByIdOnly(
      this.database.db,
      clientId,
    );
    if (!client) return;
    try {
      await persistBirthDateRequiredForClient(
        this.database.db,
        client.id,
        client.type,
        client.registrationConfig,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(
        `Falha ao exigir data de nascimento no cliente ${clientId}: ${msg}`,
      );
    }
  }

  private ensureCompany(user: JwtPayload): string {
    const companyId = user.companyId ?? undefined;
    if (!companyId) {
      throw new ForbiddenException('Sem permissão.');
    }
    return companyId;
  }

  async list(user: JwtPayload, filterClientId?: string) {
    const companyId = this.ensureCompany(user);
    if (user.role === 'company_admin') {
      return readersQueries.listReaders(
        this.database.db,
        companyId,
        filterClientId,
      );
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
      return readersQueries.listReaders(
        this.database.db,
        companyId,
        filterClientId,
      );
    }
    throw new ForbiddenException('Sem permissão.');
  }

  async listOptionsForClientTenant(user: JwtPayload): Promise<
    {
      id: string;
      name: string;
      brand: readersQueries.ReaderBrand;
      direction: readersQueries.ReaderDirection | null;
      isActive: boolean;
    }[]
  > {
    const companyId = user.companyId?.trim();
    const clientId = user.clientId?.trim();
    if (!companyId || !clientId) {
      throw new ForbiddenException('Cliente não associado ao usuário.');
    }
    const rows = await readersQueries.listReaders(
      this.database.db,
      companyId,
      clientId,
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      brand: row.brand,
      direction: row.direction,
      isActive: row.isActive,
    }));
  }

  async getMonitorStatusForClientTenant(user: JwtPayload) {
    if (user.role !== 'client_admin') {
      throw new ForbiddenException('Sem permissão.');
    }
    const companyId = user.companyId?.trim();
    const clientId = user.clientId?.trim();
    if (!companyId || !clientId) {
      throw new ForbiddenException('Cliente não associado ao usuário.');
    }
    return this.faceListener.getMonitorReportForCompany(companyId, clientId);
  }

  async getMonitorStatus(user: JwtPayload, filterClientId?: string) {
    const companyId = this.ensureCompany(user);
    if (user.role === 'company_admin') {
      return this.faceListener.getMonitorReportForCompany(
        companyId,
        filterClientId,
      );
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
      return this.faceListener.getMonitorReportForCompany(
        companyId,
        filterClientId,
      );
    }
    throw new ForbiddenException('Sem permissão.');
  }

  async create(user: JwtPayload, body: unknown) {
    if (user.role !== 'company_admin') {
      throw new ForbiddenException('Sem permissão.');
    }
    const companyId = this.ensureCompany(user);
    const parsed = createReaderSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;
    const cipher = createReaderCredentialsCipher(
      this.configService.get('READER_ENCRYPTION_KEY', { infer: true }),
    );

    const passwordEncrypted = d.password ? cipher.encrypt(d.password) : null;
    const username = d.username ?? null;

    const row = await readersQueries.createReader(this.database.db, {
      companyId,
      clientId: d.clientId,
      brand: d.brand,
      direction: d.direction ?? null,
      name: d.name,
      description: d.description,
      ip: d.ip,
      port: d.port,
      serialNumber: d.serialNumber,
      model: d.model,
      location: d.location,
      username,
      passwordEncrypted,
      isActive: d.isActive,
      restrictMinors: d.restrictMinors,
      connectionMode: d.connectionMode ?? 'direct',
      autoRegisterDeviceId: d.autoRegisterDeviceId ?? null,
    });
    if (!row) {
      throw new BadRequestException(
        'Cliente não encontrado ou sem vínculo com a empresa.',
      );
    }
    let saved = row;
    if (row.connectionMode === 'auto_register') {
      const withDeviceId = await readersQueries.updateReader(
        this.database.db,
        row.id,
        companyId,
        { autoRegisterDeviceId: autoRegisterDeviceIdFromReader(row.id) },
      );
      if (!withDeviceId || !('passwordEncrypted' in withDeviceId)) {
        throw new BadRequestException(
          'Não foi possível gravar o ID de registro automático.',
        );
      }
      saved = withDeviceId;
    }
    if (d.restrictMinors === true) {
      await this.ensureBirthDateRequired(d.clientId);
    }
    return readersQueries.readerRowToPublic(saved);
  }

  async update(user: JwtPayload, readerId: string, body: unknown) {
    if (user.role !== 'company_admin') {
      throw new ForbiddenException('Sem permissão.');
    }
    const companyId = this.ensureCompany(user);
    const parsed = updateReaderSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;
    if (
      d.clientId === undefined &&
      d.brand === undefined &&
      d.name === undefined &&
      d.description === undefined &&
      d.ip === undefined &&
      d.port === undefined &&
      d.serialNumber === undefined &&
      d.model === undefined &&
      d.location === undefined &&
      d.isActive === undefined &&
      d.restrictMinors === undefined &&
      d.username === undefined &&
      d.password === undefined &&
      d.direction === undefined &&
      d.connectionMode === undefined &&
      d.autoRegisterDeviceId === undefined
    ) {
      throw new BadRequestException('Nada para atualizar.');
    }

    const existing = await readersQueries.getReaderById(
      this.database.db,
      readerId,
      companyId,
    );
    if (!existing) {
      throw new NotFoundException('Leitor não encontrado.');
    }

    const cipher = createReaderCredentialsCipher(
      this.configService.get('READER_ENCRYPTION_KEY', { infer: true }),
    );

    const patch: readersQueries.ReaderUpdateInput = {
      ...(d.clientId !== undefined ? { clientId: d.clientId } : {}),
      ...(d.brand !== undefined ? { brand: d.brand } : {}),
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.description !== undefined
        ? { description: d.description ?? null }
        : {}),
      ...(d.ip !== undefined ? { ip: d.ip } : {}),
      ...(d.port !== undefined ? { port: d.port } : {}),
      ...(d.serialNumber !== undefined
        ? { serialNumber: d.serialNumber ?? null }
        : {}),
      ...(d.model !== undefined ? { model: d.model ?? null } : {}),
      ...(d.location !== undefined ? { location: d.location ?? null } : {}),
      ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      ...(d.restrictMinors !== undefined
        ? { restrictMinors: d.restrictMinors }
        : {}),
      ...(d.direction !== undefined ? { direction: d.direction } : {}),
      ...(d.connectionMode !== undefined
        ? { connectionMode: d.connectionMode }
        : {}),
      ...(d.autoRegisterDeviceId !== undefined
        ? { autoRegisterDeviceId: d.autoRegisterDeviceId ?? null }
        : {}),
    };

    const connectionMode = d.connectionMode ?? existing.connectionMode;
    if (connectionMode === 'auto_register') {
      patch.autoRegisterDeviceId = autoRegisterDeviceIdFromReader(readerId);
    }

    if (d.username !== undefined) {
      patch.username = d.username;
      if (!d.username?.trim()) {
        patch.passwordEncrypted = null;
        if (d.password) {
          throw new BadRequestException(
            'Não é possível definir senha sem usuário do leitor.',
          );
        }
      }
    }

    if (d.password) {
      const effectiveUser =
        d.username !== undefined ? d.username : existing.username;
      if (!effectiveUser?.trim()) {
        throw new BadRequestException(
          'Defina o usuário do leitor antes de salvar a senha.',
        );
      }
      patch.passwordEncrypted = cipher.encrypt(d.password);
    }

    const updated = await readersQueries.updateReader(
      this.database.db,
      readerId,
      companyId,
      patch,
    );
    if (!updated) throw new NotFoundException('Leitor não encontrado.');

    if (existing.restrictMinors !== true && d.restrictMinors === true) {
      await this.ensureBirthDateRequired(existing.clientId);
      try {
        await this.faceSync.enqueueMinorRestrictionCleanup(
          existing.clientId,
          readerId,
          user.sub,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn(
          `Falha ao enfileirar limpeza de menores no leitor ${readerId}: ${msg}`,
        );
      }
    }

    if ('companyId' in updated) {
      return updated;
    }
    return readersQueries.readerRowToPublic(updated);
  }

  async previewIntelbrasPush(user: JwtPayload, readerId: string) {
    if (user.role !== 'company_admin') {
      throw new ForbiddenException('Sem permissão.');
    }
    const companyId = this.ensureCompany(user);
    return this.intelbrasPushProvision.preview(companyId, readerId);
  }

  async provisionIntelbrasPush(
    user: JwtPayload,
    readerId: string,
    mode?: string,
  ) {
    if (user.role !== 'company_admin') {
      throw new ForbiddenException('Sem permissão.');
    }
    const companyId = this.ensureCompany(user);
    const chosen: IntelbrasPushMode | undefined =
      mode === 'v1' || mode === 'v2' ? mode : undefined;
    return this.intelbrasPushProvision.provision(companyId, readerId, chosen);
  }

  async provisionAllIntelbrasPush(user: JwtPayload, clientId?: string) {
    if (user.role !== 'company_admin') {
      throw new ForbiddenException('Sem permissão.');
    }
    const companyId = this.ensureCompany(user);
    return this.intelbrasPushProvision.provisionIntelbrasForClient(
      companyId,
      clientId,
    );
  }

  async setActive(user: JwtPayload, readerId: string, body: unknown) {
    if (user.role !== 'company_admin') {
      throw new ForbiddenException('Sem permissão.');
    }
    const companyId = this.ensureCompany(user);
    const parsed = toggleActiveSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const existing = await readersQueries.getReaderById(
      this.database.db,
      readerId,
      companyId,
    );
    if (!existing) throw new NotFoundException('Leitor não encontrado.');
    const row = await readersQueries.setReaderActive(
      this.database.db,
      readerId,
      companyId,
      parsed.data.isActive,
    );
    if (!row) throw new NotFoundException('Leitor não encontrado.');
    return readersQueries.readerRowToPublic(row);
  }
}
