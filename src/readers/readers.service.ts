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
import type { FeatureSlug } from '../common/features.constants';
import type { EnvVars } from '../config/env.validation';
import { DatabaseService } from '../database/database.service';
import * as readersQueries from '../database/queries/readers.queries';
import { FaceListenerService } from '../face-listener/face-listener.service';
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
        'clients' as FeatureSlug,
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
        'clients' as FeatureSlug,
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
      d.password === undefined
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
