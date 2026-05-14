import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import type { FeatureSlug } from '../common/features.constants';
import * as clientsQueries from '../database/queries/clients.queries';
import * as shiftsQueries from '../database/queries/shifts.queries';
import { DatabaseService } from '../database/database.service';
import { PermissionsService } from '../permissions/permissions.service';
import {
  createShiftSchema,
  updateShiftSchema,
} from '../validation/shifts.schema';
import { zodFirstMessage } from '../validation/zod-utils';

@Injectable()
export class ShiftsService {
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

  /** Empresa (admin/operador com permissão) ou tenant `client_admin` do próprio cliente. */
  private async assertManageClient(user: JwtPayload, clientId: string) {
    if (user.role === 'client_admin') {
      const tenantClientId = user.clientId ?? undefined;
      if (!tenantClientId || tenantClientId !== clientId) {
        throw new ForbiddenException('Sem permissão.');
      }
      const client = await clientsQueries.getClientByIdOnly(
        this.database.db,
        clientId,
      );
      if (!client) {
        throw new NotFoundException('Cliente não encontrado.');
      }
      return client;
    }

    if (
      user.role !== 'company_admin' &&
      user.role !== 'company_operator'
    ) {
      throw new ForbiddenException('Sem permissão.');
    }

    const companyId = this.ensureCompany(user);

    if (user.role === 'company_admin') {
      const client = await clientsQueries.getClientById(
        this.database.db,
        clientId,
        companyId,
      );
      if (!client) {
        throw new NotFoundException('Cliente não encontrado.');
      }
      return client;
    }

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
    if (!client) {
      throw new NotFoundException('Cliente não encontrado.');
    }
    return client;
  }

  async list(user: JwtPayload, clientId: string) {
    await this.assertManageClient(user, clientId);
    return shiftsQueries.listShiftsByClient(this.database.db, clientId);
  }

  async getById(user: JwtPayload, clientId: string, shiftId: string) {
    await this.assertManageClient(user, clientId);
    const row = await shiftsQueries.getShiftById(
      this.database.db,
      shiftId,
      clientId,
    );
    if (!row) {
      throw new NotFoundException('Turno não encontrado.');
    }
    return row;
  }

  async create(user: JwtPayload, clientId: string, body: unknown) {
    await this.assertManageClient(user, clientId);
    const parsed = createShiftSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;
    return shiftsQueries.insertShift(this.database.db, {
      clientId,
      name: d.name,
      schedule: d.schedule,
      isActive: d.isActive,
    });
  }

  async update(user: JwtPayload, clientId: string, shiftId: string, body: unknown) {
    await this.assertManageClient(user, clientId);
    const parsed = updateShiftSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;
    if (
      d.name === undefined &&
      d.schedule === undefined &&
      d.isActive === undefined
    ) {
      throw new BadRequestException('Nada para atualizar.');
    }
    const updated = await shiftsQueries.updateShift(
      this.database.db,
      shiftId,
      clientId,
      {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.schedule !== undefined ? { schedule: d.schedule } : {}),
        ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      },
    );
    if (!updated) {
      throw new NotFoundException('Turno não encontrado.');
    }
    return updated;
  }

  async remove(user: JwtPayload, clientId: string, shiftId: string) {
    await this.assertManageClient(user, clientId);
    const deleted = await shiftsQueries.deleteShift(
      this.database.db,
      shiftId,
      clientId,
    );
    if (!deleted) {
      throw new NotFoundException('Turno não encontrado.');
    }
    return { ok: true };
  }
}
