import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  MAX_GENERATED_UNITS,
  type CreateClientBlockInput,
  type CreateClientUnitInput,
  type GenerateClientUnitsInput,
  type UpdateClientBlockInput,
  type UpdateClientUnitInput,
} from '../validation/client-blocks.schema';
import { ClientBlocksRepository } from './client-blocks.repository';
import { CondominiumAccessService } from './condominium-access.service';

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}

function namesToCreate(start: number, end: number, existing: string[]) {
  const taken = new Set(existing.map((name) => name.toLowerCase()));
  const names: string[] = [];
  for (let n = start; n <= end; n += 1) {
    const name = String(n);
    if (!taken.has(name.toLowerCase())) names.push(name);
  }
  return names;
}

@Injectable()
export class ClientBlocksService {
  constructor(
    private readonly access: CondominiumAccessService,
    private readonly blocks: ClientBlocksRepository,
  ) {}

  list(user: JwtPayload, clientId: string) {
    return this.access
      .assertRead(user, clientId)
      .then(() => this.blocks.listCatalog(clientId));
  }

  async createBlock(
    user: JwtPayload,
    clientId: string,
    input: CreateClientBlockInput,
  ) {
    await this.access.assertManage(user, clientId);
    await this.assertBlockNameAvailable(clientId, input.name);
    try {
      return await this.blocks.insertBlock(clientId, input.name);
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Já existe um bloco com esse nome.');
      }
      throw err;
    }
  }

  async updateBlock(
    user: JwtPayload,
    clientId: string,
    blockId: string,
    input: UpdateClientBlockInput,
  ) {
    await this.access.assertManage(user, clientId);
    const current = await this.blocks.getBlock(clientId, blockId);
    if (!current) throw new NotFoundException('Bloco não encontrado.');

    if (input.isActive === false) {
      const activeUnits = await this.blocks.countActiveUnitsInBlock(blockId);
      if (activeUnits > 0) {
        throw new BadRequestException(
          'Desative as unidades deste bloco antes.',
        );
      }
    }

    if (input.name && input.name.toLowerCase() !== current.name.toLowerCase()) {
      await this.assertBlockNameAvailable(clientId, input.name);
    }

    let updated: Awaited<ReturnType<ClientBlocksRepository['updateBlock']>>;
    try {
      updated = await this.blocks.updateBlock(clientId, blockId, {
        name: input.name,
        isActive: input.isActive,
      });
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Já existe um bloco com esse nome.');
      }
      throw err;
    }
    if (!updated) throw new NotFoundException('Bloco não encontrado.');
    if (input.name && input.name !== current.name) {
      await this.blocks.syncBlockLabel(blockId, updated.name);
    }
    return updated;
  }

  async createUnit(
    user: JwtPayload,
    clientId: string,
    blockId: string,
    input: CreateClientUnitInput,
  ) {
    await this.access.assertManage(user, clientId);
    const block = await this.requireActiveBlock(clientId, blockId);
    await this.assertUnitNameAvailable(block.id, input.name);
    try {
      return await this.blocks.insertUnit(clientId, block.id, input.name);
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Já existe uma unidade com esse nome.');
      }
      throw err;
    }
  }

  async generateUnits(
    user: JwtPayload,
    clientId: string,
    blockId: string,
    input: GenerateClientUnitsInput,
  ) {
    await this.access.assertManage(user, clientId);
    const block = await this.requireActiveBlock(clientId, blockId);
    const span = input.end - input.start + 1;
    if (span > MAX_GENERATED_UNITS) {
      throw new BadRequestException(
        `Gere no máximo ${MAX_GENERATED_UNITS} unidades por vez.`,
      );
    }
    const existing = await this.blocks.listUnitNames(block.id);
    const names = namesToCreate(input.start, input.end, existing);
    if (names.length > 0) {
      try {
        await this.blocks.insertUnits(clientId, block.id, names);
      } catch (err: unknown) {
        if (isUniqueViolation(err)) {
          throw new ConflictException('Já existe uma unidade com esse nome.');
        }
        throw err;
      }
    }
    return { created: names.length, skipped: span - names.length };
  }

  async updateUnit(
    user: JwtPayload,
    clientId: string,
    unitId: string,
    input: UpdateClientUnitInput,
  ) {
    await this.access.assertManage(user, clientId);
    const current = await this.blocks.getUnitWithBlock(clientId, unitId);
    if (!current) throw new NotFoundException('Unidade não encontrada.');

    if (input.isActive === false) {
      const occupants = await this.blocks.countActiveOccupants(unitId);
      if (occupants > 0) {
        throw new BadRequestException(
          'Esta unidade ainda tem pessoas vinculadas.',
        );
      }
    }
    if (
      input.name &&
      input.name.toLowerCase() !== current.unit.name.toLowerCase()
    ) {
      await this.assertUnitNameAvailable(current.block.id, input.name);
    }

    let updated: Awaited<ReturnType<ClientBlocksRepository['updateUnit']>>;
    try {
      updated = await this.blocks.updateUnit(clientId, unitId, {
        name: input.name,
        isActive: input.isActive,
      });
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Já existe uma unidade com esse nome.');
      }
      throw err;
    }
    if (!updated) throw new NotFoundException('Unidade não encontrada.');
    if (input.name && input.name !== current.unit.name) {
      await this.blocks.syncUnitLabel(
        unitId,
        current.block.name,
        updated.name,
      );
    }
    return updated;
  }

  async mergeUnit(
    user: JwtPayload,
    clientId: string,
    sourceUnitId: string,
    targetUnitId: string,
  ) {
    await this.access.assertManage(user, clientId);
    if (sourceUnitId === targetUnitId) {
      throw new BadRequestException('Escolha outra unidade para unir.');
    }
    const source = await this.blocks.getUnitWithBlock(clientId, sourceUnitId);
    const target = await this.blocks.getUnitWithBlock(clientId, targetUnitId);
    if (!source || !target) {
      throw new NotFoundException('Unidade não encontrada.');
    }
    if (!target.unit.isActive || !target.block.isActive) {
      throw new BadRequestException('A unidade de destino está inativa.');
    }
    await this.blocks.mergeUnits({
      sourceUnitId,
      targetUnitId,
      blockName: target.block.name,
      unitName: target.unit.name,
    });
    return { success: true as const };
  }

  private async requireActiveBlock(clientId: string, blockId: string) {
    const block = await this.blocks.getBlock(clientId, blockId);
    if (!block || !block.isActive) {
      throw new BadRequestException('Bloco inválido.');
    }
    return block;
  }

  private async assertBlockNameAvailable(clientId: string, name: string) {
    const existing = await this.blocks.findBlockByName(clientId, name);
    if (!existing) return;
    if (existing.isActive) {
      throw new ConflictException('Já existe um bloco com esse nome.');
    }
    throw new ConflictException(
      'Já existe um bloco inativo com esse nome. Reative-o.',
    );
  }

  private async assertUnitNameAvailable(blockId: string, name: string) {
    const existing = await this.blocks.findUnitByName(blockId, name);
    if (!existing) return;
    if (existing.isActive) {
      throw new ConflictException('Já existe uma unidade com esse nome.');
    }
    throw new ConflictException(
      'Já existe uma unidade inativa com esse nome. Reative-a.',
    );
  }
}
