import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { createReaderCredentialsCipher } from '../common/crypto/reader-credentials.cipher';
import type { EnvVars } from '../config/env.validation';
import { DatabaseService } from '../database/database.service';
import * as readersQueries from '../database/queries/readers.queries';
import { FaceListenerService } from '../face-listener/face-listener.service';
import {
  IntelbrasPushProvisionService,
  type IntelbrasPushMode,
} from '../intelbras-push/intelbras-push.provision.service';
import {
  intelbrasGetDeviceUsers,
  intelbrasGetFaceImage,
  intelbrasRemoveUserFromReader,
  intelbrasSearchDeviceUsers,
  toPlainReaderCredential,
} from '../face-sync/intelbras-device.client';
import {
  hikvisionDeleteUser,
  hikvisionGetDeviceUsers,
  hikvisionGetFaceImage,
  toHikvisionConnection,
} from '../integrations/hikvision';
import { PermissionsService } from '../permissions/permissions.service';
import {
  createReaderSchema,
  updateReaderSchema,
} from '../validation/readers.schema';
import { zodFirstMessage } from '../validation/zod-utils';

const toggleActiveSchema = z.object({
  isActive: z.boolean(),
});

@Injectable()
export class ReadersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly permissionsService: PermissionsService,
    private readonly faceListener: FaceListenerService,
    private readonly configService: ConfigService<EnvVars, true>,
    private readonly intelbrasPushProvision: IntelbrasPushProvisionService,
  ) {}

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
    });
    if (!row) {
      throw new BadRequestException(
        'Cliente não encontrado ou sem vínculo com a empresa.',
      );
    }
    return readersQueries.readerRowToPublic(row);
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
      d.username === undefined &&
      d.password === undefined &&
      d.direction === undefined
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
      ...(d.direction !== undefined ? { direction: d.direction } : {}),
    };

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

  async getDeviceUsers(
    user: JwtPayload,
    readerId: string,
    limit: number,
    offset: number,
    search?: string,
  ) {
    if (user.role !== 'company_admin' && user.role !== 'company_operator') {
      throw new ForbiddenException('Sem permissão.');
    }
    const companyId = this.ensureCompany(user);

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
    }

    const reader = await readersQueries.getReaderWithCredentialsById(
      this.database.db,
      readerId,
      companyId,
    );

    if (!reader) {
      throw new NotFoundException('Leitor não encontrado.');
    }
    if (!reader.isActive) {
      throw new BadRequestException('O leitor está inativo.');
    }
    if (!reader.username || !reader.passwordEncrypted) {
      throw new BadRequestException('O leitor não possui credenciais salvas.');
    }

    const cipher = createReaderCredentialsCipher(
      this.configService.get('READER_ENCRYPTION_KEY', { infer: true }),
    );
    const plainPassword = cipher.decrypt(reader.passwordEncrypted);

    const plainReader = toPlainReaderCredential(
      {
        id: reader.id,
        name: reader.name,
        brand: reader.brand ?? 'intelbras',
        ip: reader.ip,
        port: reader.port,
        username: reader.username,
        passwordEncrypted: reader.passwordEncrypted,
      },
      plainPassword,
    );

    try {
      if (reader.brand === 'hikvision') {
        const connection = toHikvisionConnection(plainReader);
        const safeLimit = Math.min(Math.max(limit, 1), 500);
        const safeOffset = Math.max(offset, 0);
        const term = search?.trim();

        const resolved = await hikvisionGetDeviceUsers(
          connection,
          safeLimit,
          safeOffset,
          term,
        );

        return {
          totalCount: resolved.totalCount,
          found: resolved.found,
          records: resolved.records.map((r) => ({
            UserID: r.userId,
            CardName: r.name,
            CardNo: r.cardNo ?? r.userId,
            ValidDateStart: r.validFrom ?? undefined,
            ValidDateEnd: r.validTo ?? undefined,
            HasFace: r.hasFace ?? null,
          })),
        };
      }

      if (search) {
        return await intelbrasSearchDeviceUsers(
          plainReader,
          search,
          limit,
          offset,
        );
      }
      return await intelbrasGetDeviceUsers(plainReader, limit, offset);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro desconhecido';
      throw new BadRequestException('Falha ao comunicar com o leitor: ' + msg);
    }
  }

  async removeDeviceUser(user: JwtPayload, readerId: string, userId: string) {
    if (user.role !== 'company_admin' && user.role !== 'company_operator') {
      throw new ForbiddenException('Sem permissão.');
    }
    const companyId = this.ensureCompany(user);

    if (user.role === 'company_operator') {
      const ok = await this.permissionsService.evaluateCompanyFeatureAction(
        user.role,
        user.companyUserId,
        'clients',
        'can_delete',
      );
      if (!ok) {
        throw new ForbiddenException('Sem permissão.');
      }
    }

    const reader = await readersQueries.getReaderWithCredentialsById(
      this.database.db,
      readerId,
      companyId,
    );

    if (!reader) {
      throw new NotFoundException('Leitor não encontrado.');
    }
    if (!reader.isActive) {
      throw new BadRequestException('O leitor está inativo.');
    }
    if (!reader.username || !reader.passwordEncrypted) {
      throw new BadRequestException('O leitor não possui credenciais salvas.');
    }

    const cipher = createReaderCredentialsCipher(
      this.configService.get('READER_ENCRYPTION_KEY', { infer: true }),
    );
    const plainPassword = cipher.decrypt(reader.passwordEncrypted);

    const plainReader = toPlainReaderCredential(
      {
        id: reader.id,
        name: reader.name,
        brand: reader.brand ?? 'intelbras',
        ip: reader.ip,
        port: reader.port,
        username: reader.username,
        passwordEncrypted: reader.passwordEncrypted,
      },
      plainPassword,
    );

    try {
      if (reader.brand === 'hikvision') {
        const connection = toHikvisionConnection(plainReader);
        const result = await hikvisionDeleteUser(connection, userId);
        if (!result.success) {
          throw new Error(result.error ?? 'Falha ao remover usuário');
        }
        return { success: true };
      }
      await intelbrasRemoveUserFromReader(plainReader, userId);
      return { success: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro desconhecido';
      throw new BadRequestException('Falha ao comunicar com o leitor: ' + msg);
    }
  }

  async getDeviceUserFace(user: JwtPayload, readerId: string, userId: string) {
    if (user.role !== 'company_admin' && user.role !== 'company_operator') {
      throw new ForbiddenException('Sem permissão.');
    }
    const companyId = this.ensureCompany(user);

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
    }

    const reader = await readersQueries.getReaderWithCredentialsById(
      this.database.db,
      readerId,
      companyId,
    );

    if (!reader) {
      throw new NotFoundException('Leitor não encontrado.');
    }
    if (!reader.isActive) {
      throw new BadRequestException('O leitor está inativo.');
    }
    if (!reader.username || !reader.passwordEncrypted) {
      throw new BadRequestException('O leitor não possui credenciais salvas.');
    }

    const cipher = createReaderCredentialsCipher(
      this.configService.get('READER_ENCRYPTION_KEY', { infer: true }),
    );
    const plainPassword = cipher.decrypt(reader.passwordEncrypted);

    const plainReader = toPlainReaderCredential(
      {
        id: reader.id,
        name: reader.name,
        brand: reader.brand ?? 'intelbras',
        ip: reader.ip,
        port: reader.port,
        username: reader.username,
        passwordEncrypted: reader.passwordEncrypted,
      },
      plainPassword,
    );

    try {
      if (reader.brand === 'hikvision') {
        const connection = toHikvisionConnection(plainReader);
        return await hikvisionGetFaceImage(connection, userId);
      }
      return await intelbrasGetFaceImage(plainReader, userId);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro desconhecido';
      throw new BadRequestException('Falha ao comunicar com o leitor: ' + msg);
    }
  }
}
