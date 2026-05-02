import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import type { FeatureSlug } from '../common/features.constants';
import { DatabaseService } from '../database/database.service';
import * as readersQueries from '../database/queries/readers.queries';
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
      isActive: d.isActive,
    });
    if (!row) {
      throw new BadRequestException(
        'Cliente não encontrado ou sem vínculo com a empresa.',
      );
    }
    return row;
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
      d.isActive === undefined
    ) {
      throw new BadRequestException('Nada para atualizar.');
    }
    const updated = await readersQueries.updateReader(
      this.database.db,
      readerId,
      companyId,
      {
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
      },
    );
    if (!updated) throw new NotFoundException('Leitor não encontrado.');
    return updated;
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
    return readersQueries.setReaderActive(
      this.database.db,
      readerId,
      companyId,
      parsed.data.isActive,
    );
  }
}
