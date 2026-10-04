import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ClientBlocksRemovalRepository } from './client-blocks-removal.repository';
import { ClientBlocksRepository } from './client-blocks.repository';
import { CondominiumAccessService } from './condominium-access.service';
import { LocationReviewRepository } from './location-review.repository';

const UNIT_IN_USE_MESSAGE =
  'Esta unidade tem pessoas vinculadas (inclusive inativas) e não pode ser excluída.';
const BLOCK_IN_USE_MESSAGE =
  'Há pessoas vinculadas (inclusive inativas) a unidades deste bloco; ele não pode ser excluído.';

function isForeignKeyViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23503'
  );
}

@Injectable()
export class ClientBlocksRemovalService {
  constructor(
    private readonly access: CondominiumAccessService,
    private readonly blocks: ClientBlocksRepository,
    private readonly removal: ClientBlocksRemovalRepository,
    private readonly review: LocationReviewRepository,
  ) {}

  /** Quem está vinculado à unidade (inclusive inativos), para decidir antes de excluir. */
  async listUnitPeople(user: JwtPayload, clientId: string, unitId: string) {
    await this.access.assertRead(user, clientId);
    const current = await this.blocks.getUnitWithBlock(clientId, unitId);
    if (!current) throw new NotFoundException('Unidade não encontrada.');
    const people = await this.review.listLinkedPeople(clientId, unitId);
    return people.map(({ kind, id, name, faceId, active }) => ({
      kind,
      id,
      name,
      faceId,
      active,
    }));
  }

  async deleteUnit(user: JwtPayload, clientId: string, unitId: string) {
    await this.access.assertManage(user, clientId);
    const current = await this.blocks.getUnitWithBlock(clientId, unitId);
    if (!current) throw new NotFoundException('Unidade não encontrada.');
    if (current.unit.isActive) {
      throw new BadRequestException('Desative a unidade antes de excluir.');
    }
    if ((await this.removal.countUnitReferences([unitId])) > 0) {
      throw new ConflictException(UNIT_IN_USE_MESSAGE);
    }
    try {
      await this.removal.deleteUnit(clientId, unitId);
    } catch (err: unknown) {
      if (isForeignKeyViolation(err)) {
        throw new ConflictException(UNIT_IN_USE_MESSAGE);
      }
      throw err;
    }
    return { deleted: true };
  }

  async deleteBlock(user: JwtPayload, clientId: string, blockId: string) {
    await this.access.assertManage(user, clientId);
    const block = await this.blocks.getBlock(clientId, blockId);
    if (!block) throw new NotFoundException('Bloco não encontrado.');
    if (block.isActive) {
      throw new BadRequestException('Desative o bloco antes de excluir.');
    }
    const unitIds = await this.removal.listUnitIds(clientId, blockId);
    if ((await this.removal.countUnitReferences(unitIds)) > 0) {
      throw new ConflictException(BLOCK_IN_USE_MESSAGE);
    }
    try {
      await this.removal.deleteBlock(clientId, blockId);
    } catch (err: unknown) {
      if (isForeignKeyViolation(err)) {
        throw new ConflictException(BLOCK_IN_USE_MESSAGE);
      }
      throw err;
    }
    return { deleted: true };
  }
}
