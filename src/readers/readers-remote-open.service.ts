import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AccessesService } from '../accesses/accesses.service';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import type { EnvVars } from '../config/env.validation';
import { DatabaseService } from '../database/database.service';
import * as clientsQueries from '../database/queries/clients.queries';
import {
  hikvisionOpenDoor,
  toHikvisionConnection,
} from '../integrations/hikvision';
import { intelbrasOpenDoor } from '../integrations/intelbras/intelbras-door.client';
import {
  ensureCompanyId,
  loadActiveDeviceReader,
  type LoadedDeviceReader,
} from './readers-device-access';

const REMOTE_OPEN_COOLDOWN_MS = 3_000;

export type RemoteOpenResult = {
  opened: boolean;
  message: string;
};

@Injectable()
export class ReadersRemoteOpenService {
  private readonly lastOpenAt = new Map<string, number>();

  constructor(
    private readonly database: DatabaseService,
    private readonly configService: ConfigService<EnvVars, true>,
    private readonly accesses: AccessesService,
  ) {}

  async openForCompany(
    user: JwtPayload,
    readerId: string,
  ): Promise<RemoteOpenResult> {
    if (user.role !== 'company_admin') {
      throw new ForbiddenException('Sem permissão.');
    }
    const companyId = ensureCompanyId(user);
    const loaded = await loadActiveDeviceReader(
      this.database.db,
      this.configService,
      companyId,
      readerId,
    );
    return this.openLoaded(user, companyId, loaded);
  }

  async openForClientTenant(
    user: JwtPayload,
    readerId: string,
  ): Promise<RemoteOpenResult> {
    if (user.role !== 'client_admin') {
      throw new ForbiddenException('Sem permissão.');
    }
    const companyId = ensureCompanyId(user);
    const clientId = user.clientId?.trim();
    if (!clientId) {
      throw new ForbiddenException('Cliente não associado ao usuário.');
    }
    const loaded = await loadActiveDeviceReader(
      this.database.db,
      this.configService,
      companyId,
      readerId,
    );
    if (loaded.clientId !== clientId) {
      throw new NotFoundException('Leitor não encontrado.');
    }
    return this.openLoaded(user, companyId, loaded);
  }

  private async openLoaded(
    user: JwtPayload,
    companyId: string,
    loaded: LoadedDeviceReader,
  ): Promise<RemoteOpenResult> {
    this.assertCooldown(loaded.id);

    const client = await clientsQueries.getClientById(
      this.database.db,
      loaded.clientId,
      companyId,
    );
    const actorName = user.name?.trim() || user.email;
    const historyBase = {
      companyId,
      readerId: loaded.id,
      readerName: loaded.name,
      clientId: loaded.clientId,
      clientName: client?.name ?? loaded.clientId,
      readerDirection: loaded.direction,
      triggeredByUserId: user.sub,
      triggeredByName: actorName,
    };

    try {
      if (loaded.brand === 'hikvision') {
        await hikvisionOpenDoor(toHikvisionConnection(loaded.plain));
      } else {
        await intelbrasOpenDoor(loaded.plain);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Falha ao acionar a porta do leitor.';
      await this.accesses.recordRemoteOpen({
        ...historyBase,
        opened: false,
      });
      throw new BadRequestException(message);
    }

    await this.accesses.recordRemoteOpen({
      ...historyBase,
      opened: true,
    });
    return { opened: true, message: 'Porta acionada.' };
  }

  private assertCooldown(readerId: string) {
    const now = Date.now();
    const previous = this.lastOpenAt.get(readerId) ?? 0;
    if (now - previous < REMOTE_OPEN_COOLDOWN_MS) {
      throw new BadRequestException(
        'Aguarde alguns segundos antes de acionar novamente.',
      );
    }
    this.lastOpenAt.set(readerId, now);
  }
}
