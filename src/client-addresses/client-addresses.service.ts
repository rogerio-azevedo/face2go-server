import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ClientAddressesRepository } from '../database/repositories/client-addresses.repository';
import * as clientsQueries from '../database/queries/clients.queries';
import { DatabaseService } from '../database/database.service';
import { PermissionsService } from '../permissions/permissions.service';
import type {
  CreateClientAddressInput,
  UpdateClientAddressInput,
} from '../validation/client-addresses.schema';

function toResponse(row: {
  id: string;
  clientId: string;
  label: string;
  isPrimary: boolean;
  cep: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  country: string;
  latitude: string | null;
  longitude: string | null;
  geocodingProvider: 'here' | 'manual';
  geocodingPrecision: 'rooftop' | 'street' | 'approximate' | null;
  hereLocationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...row,
    latitude: row.latitude ? Number(row.latitude) : null,
    longitude: row.longitude ? Number(row.longitude) : null,
  };
}

@Injectable()
export class ClientAddressesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly addressesRepository: ClientAddressesRepository,
    private readonly permissionsService: PermissionsService,
  ) {}

  private ensureCompany(user: JwtPayload): string {
    const companyId = user.companyId ?? undefined;
    if (!companyId) {
      throw new ForbiddenException('Sem permissão.');
    }
    return companyId;
  }

  private async assertReadAccess(
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
      if (!row) throw new NotFoundException('Cliente não encontrado.');
      return companyId;
    }
    if (user.role === 'company_operator') {
      const ok = await this.permissionsService.evaluateCompanyFeatureAction(
        user.role,
        user.companyUserId,
        'clients',
        'can_read',
      );
      if (!ok) throw new ForbiddenException('Sem permissão.');
      const row = await clientsQueries.getClientById(
        this.database.db,
        clientId,
        companyId,
      );
      if (!row) throw new NotFoundException('Cliente não encontrado.');
      return companyId;
    }
    throw new ForbiddenException('Sem permissão.');
  }

  private async assertWriteAccess(
    user: JwtPayload,
    clientId: string,
  ): Promise<void> {
    await this.assertReadAccess(user, clientId);
    if (user.role === 'company_admin') return;
    if (user.role === 'company_operator') {
      const ok = await this.permissionsService.evaluateCompanyFeatureAction(
        user.role,
        user.companyUserId,
        'clients',
        'can_update',
      );
      if (!ok) throw new ForbiddenException('Sem permissão.');
      return;
    }
    throw new ForbiddenException('Sem permissão.');
  }

  private mapInputToInsert(
    clientId: string,
    input: CreateClientAddressInput | UpdateClientAddressInput,
  ) {
    return {
      clientId,
      label: input.label,
      isPrimary: input.isPrimary,
      cep: input.cep ?? null,
      street: input.street ?? null,
      number: input.number ?? null,
      complement: input.complement ?? null,
      neighborhood: input.neighborhood ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      country: input.country ?? 'BR',
      latitude:
        input.latitude !== undefined ? String(input.latitude) : undefined,
      longitude:
        input.longitude !== undefined ? String(input.longitude) : undefined,
      geocodingProvider: input.geocodingProvider,
      geocodingPrecision: input.geocodingPrecision ?? null,
      hereLocationId: input.hereLocationId ?? null,
    };
  }

  async list(user: JwtPayload, clientId: string) {
    await this.assertReadAccess(user, clientId);
    const rows = await this.addressesRepository.listByClient(clientId);
    return rows.map(toResponse);
  }

  async getById(user: JwtPayload, clientId: string, addressId: string) {
    await this.assertReadAccess(user, clientId);
    const row = await this.addressesRepository.getById(clientId, addressId);
    if (!row) throw new NotFoundException('Endereço não encontrado.');
    return toResponse(row);
  }

  async create(
    user: JwtPayload,
    clientId: string,
    input: CreateClientAddressInput,
  ) {
    await this.assertWriteAccess(user, clientId);
    const data = this.mapInputToInsert(clientId, input);
    if (data.isPrimary) {
      await this.addressesRepository.clearPrimary(clientId);
    } else {
      const existing = await this.addressesRepository.listByClient(clientId);
      if (existing.length === 0) {
        data.isPrimary = true;
      }
    }
    const row = await this.addressesRepository.create({
      clientId,
      label: data.label ?? 'Principal',
      isPrimary: data.isPrimary ?? false,
      cep: data.cep ?? null,
      street: data.street ?? null,
      number: data.number ?? null,
      complement: data.complement ?? null,
      neighborhood: data.neighborhood ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      country: data.country ?? 'BR',
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      geocodingProvider: data.geocodingProvider ?? 'manual',
      geocodingPrecision: data.geocodingPrecision ?? null,
      hereLocationId: data.hereLocationId ?? null,
    });
    return toResponse(row);
  }

  async update(
    user: JwtPayload,
    clientId: string,
    addressId: string,
    input: UpdateClientAddressInput,
  ) {
    await this.assertWriteAccess(user, clientId);
    const existing = await this.addressesRepository.getById(clientId, addressId);
    if (!existing) throw new NotFoundException('Endereço não encontrado.');

    if (input.isPrimary === true) {
      await this.addressesRepository.clearPrimary(clientId, addressId);
    }

    const patch = this.mapInputToInsert(clientId, input);
    const row = await this.addressesRepository.update(clientId, addressId, {
      label: patch.label,
      isPrimary: patch.isPrimary,
      cep: patch.cep,
      street: patch.street,
      number: patch.number,
      complement: patch.complement,
      neighborhood: patch.neighborhood,
      city: patch.city,
      state: patch.state,
      country: patch.country,
      latitude: patch.latitude,
      longitude: patch.longitude,
      geocodingProvider: patch.geocodingProvider,
      geocodingPrecision: patch.geocodingPrecision,
      hereLocationId: patch.hereLocationId,
    });
    if (!row) throw new NotFoundException('Endereço não encontrado.');
    return toResponse(row);
  }

  async remove(user: JwtPayload, clientId: string, addressId: string) {
    await this.assertWriteAccess(user, clientId);
    const existing = await this.addressesRepository.getById(clientId, addressId);
    if (!existing) throw new NotFoundException('Endereço não encontrado.');
    await this.addressesRepository.delete(clientId, addressId);
    if (existing.isPrimary) {
      const remaining = await this.addressesRepository.listByClient(clientId);
      if (remaining[0]) {
        await this.addressesRepository.setPrimary(clientId, remaining[0].id);
      }
    }
    return { ok: true };
  }

  async setPrimary(user: JwtPayload, clientId: string, addressId: string) {
    await this.assertWriteAccess(user, clientId);
    const row = await this.addressesRepository.setPrimary(clientId, addressId);
    if (!row) throw new NotFoundException('Endereço não encontrado.');
    return toResponse(row);
  }
}
