import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DatabaseService } from '../database/database.service';
import * as clientsQueries from '../database/queries/clients.queries';
import { setIenhFilialMappingSchema } from '../validation/ienh.schema';
import { zodFirstMessage } from '../validation/zod-utils';
import { IENH_FILIAL_LABELS } from './ienh.mapper';

export type IenhFilialMappingRow = {
  filialCode: number;
  filialName: string;
  clientId: string | null;
  clientName: string | null;
};

@Injectable()
export class IenhFilialMappingService {
  constructor(private readonly database: DatabaseService) {}

  private ensureCompany(user: JwtPayload): string {
    const companyId = user.companyId ?? undefined;
    if (!companyId) {
      throw new ForbiddenException('Sem permissão.');
    }
    return companyId;
  }

  async listMappings(user: JwtPayload): Promise<IenhFilialMappingRow[]> {
    const companyId = this.ensureCompany(user);
    const clients = await clientsQueries.listClientsWithIenhFilialByCompany(
      this.database.db,
      companyId,
    );
    const byFilial = new Map<
      number,
      { clientId: string; clientName: string }
    >();
    for (const c of clients) {
      if (c.ienhFilialCode != null) {
        byFilial.set(c.ienhFilialCode, { clientId: c.id, clientName: c.name });
      }
    }

    return ([1, 2, 3] as const).map((filialCode) => {
      const mapped = byFilial.get(filialCode);
      return {
        filialCode,
        filialName: IENH_FILIAL_LABELS[filialCode],
        clientId: mapped?.clientId ?? null,
        clientName: mapped?.clientName ?? null,
      };
    });
  }

  async setMapping(user: JwtPayload, body: unknown) {
    const companyId = this.ensureCompany(user);
    if (user.role !== 'company_admin' && user.role !== 'super_admin') {
      throw new ForbiddenException('Sem permissão.');
    }

    const parsed = setIenhFilialMappingSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const { filialCode, clientId } = parsed.data;

    if (clientId === null) {
      const existing = await clientsQueries.findClientByIenhFilialCode(
        this.database.db,
        companyId,
        filialCode,
      );
      if (existing) {
        await clientsQueries.updateClientIenhFilialCode(
          this.database.db,
          existing.id,
          companyId,
          null,
        );
      }
      return this.listMappings(user);
    }

    const client = await clientsQueries.getClientById(
      this.database.db,
      clientId,
      companyId,
    );
    if (!client) {
      throw new NotFoundException('Cliente não encontrado.');
    }

    await clientsQueries.clearIenhFilialCodeFromOtherClients(
      this.database.db,
      companyId,
      filialCode,
      clientId,
    );
    await clientsQueries.updateClientIenhFilialCode(
      this.database.db,
      clientId,
      companyId,
      filialCode,
    );

    return this.listMappings(user);
  }
}
