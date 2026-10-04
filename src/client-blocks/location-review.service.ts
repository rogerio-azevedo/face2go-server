import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import type {
  BindLocationGroupInput,
  EnsureLocationUnitInput,
  MoveLocationGroupInput,
} from '../validation/client-blocks.schema';
import { ClientBlocksRepository } from './client-blocks.repository';
import { ClientBlocksService } from './client-blocks.service';
import { CondominiumAccessService } from './condominium-access.service';
import { collapseText, createUnitSuggester, textKey } from './location-match';
import {
  activeCatalog,
  addPerson,
  buildLinkedGroups,
  compareText,
  emptyBucket,
  type ReviewBucket,
} from './location-review-groups';
import { LocationReviewRepository } from './location-review.repository';

@Injectable()
export class LocationReviewService {
  constructor(
    private readonly access: CondominiumAccessService,
    private readonly blocks: ClientBlocksRepository,
    private readonly clientBlocks: ClientBlocksService,
    private readonly review: LocationReviewRepository,
  ) {}

  async getClientReview(user: JwtPayload, clientId: string) {
    const client = await this.access.assertRead(user, clientId);
    const [fullCatalog, people, linkedPeople] = await Promise.all([
      this.blocks.listCatalog(clientId),
      this.review.listUnlinkedPeople(clientId),
      this.review.listLinkedPeople(clientId),
    ]);
    const catalog = activeCatalog(fullCatalog);
    const suggest = createUnitSuggester(catalog);

    const noLocation = emptyBucket();
    const groups = new Map<
      string,
      ReviewBucket & { blockText: string; unitText: string }
    >();

    for (const row of people) {
      const blockKey = textKey(row.block);
      const unitKey = textKey(row.unit);
      if (!blockKey && !unitKey) {
        addPerson(noLocation, row);
        continue;
      }
      const key = `${blockKey}|${unitKey}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          ...emptyBucket(),
          blockText: collapseText(row.block),
          unitText: collapseText(row.unit),
        };
        groups.set(key, group);
      }
      addPerson(group, row);
    }

    const groupList = [...groups.entries()]
      .map(([key, group]) => ({
        key,
        ...group,
        suggestion: suggest(group.blockText, group.unitText),
      }))
      .sort(
        (a, b) =>
          compareText(a.blockText, b.blockText) ||
          compareText(a.unitText, b.unitText),
      );
    const linkedGroups = buildLinkedGroups(fullCatalog, suggest, linkedPeople);

    return {
      client: { id: client.id, name: client.name },
      catalog,
      summary: {
        linked: linkedPeople.filter((person) => person.active).length,
        linkedGroups: linkedGroups.length,
        textOnly: groupList.reduce(
          (total, group) => total + group.registrations + group.members,
          0,
        ),
        noLocation: noLocation.registrations + noLocation.members,
      },
      groups: groupList,
      noLocation,
      linkedGroups,
    };
  }

  async moveGroups(
    user: JwtPayload,
    clientId: string,
    items: MoveLocationGroupInput[],
  ) {
    await this.access.assertManage(user, clientId);
    const resolved = await Promise.all(
      items.map(async (item) => {
        const source = await this.blocks.getUnitWithBlock(
          clientId,
          item.sourceUnitId,
        );
        if (!source) throw new NotFoundException('Unidade não encontrada.');
        if (!item.targetUnitId) return { item, target: null };
        if (item.targetUnitId === item.sourceUnitId) {
          throw new BadRequestException(
            'Escolha uma unidade diferente da atual.',
          );
        }
        const target = await this.blocks.getActiveUnitLocation(
          clientId,
          item.targetUnitId,
        );
        if (!target) {
          throw new BadRequestException(
            'Unidade de destino inválida ou inativa.',
          );
        }
        return { item, target };
      }),
    );

    const totals = { moved: 0, unlinked: 0 };
    for (const { item, target } of resolved) {
      if (target) {
        await this.blocks.mergeUnits({
          sourceUnitId: item.sourceUnitId,
          targetUnitId: target.unitId,
          blockName: target.blockName,
          unitName: target.unitName,
        });
        totals.moved += 1;
      } else {
        await this.review.unlinkUnit(clientId, item.sourceUnitId);
        totals.unlinked += 1;
      }
    }
    return totals;
  }

  async ensureUnit(
    user: JwtPayload,
    clientId: string,
    input: EnsureLocationUnitInput,
  ) {
    await this.access.assertManage(user, clientId);
    let block = await this.blocks.findBlockByName(clientId, input.blockName);
    if (block && !block.isActive) {
      throw new ConflictException(
        'Já existe um bloco inativo com esse nome. Reative-o.',
      );
    }
    block ??= await this.clientBlocks.createBlock(user, clientId, {
      name: input.blockName,
    });

    let unit = await this.blocks.findUnitByName(block.id, input.unitName);
    if (unit && !unit.isActive) {
      throw new ConflictException(
        'Já existe uma unidade inativa com esse nome. Reative-a.',
      );
    }
    unit ??= await this.clientBlocks.createUnit(user, clientId, block.id, {
      name: input.unitName,
    });

    return {
      blockId: block.id,
      blockName: block.name,
      unitId: unit.id,
      unitName: unit.name,
    };
  }

  async bindGroups(
    user: JwtPayload,
    clientId: string,
    items: BindLocationGroupInput[],
  ) {
    await this.access.assertManage(user, clientId);
    const locations = await Promise.all(
      items.map((item) =>
        this.blocks.getActiveUnitLocation(clientId, item.unitId),
      ),
    );
    const resolved = items.map((item, index) => {
      const location = locations[index];
      if (!location) {
        throw new BadRequestException('Unidade inválida ou inativa.');
      }
      return { item, location };
    });

    const totals = { registrations: 0, members: 0 };
    for (const { item, location } of resolved) {
      const bound = await this.review.bindGroup({
        clientId,
        blockText: item.blockText,
        unitText: item.unitText,
        unitId: location.unitId,
        blockName: location.blockName,
        unitName: location.unitName,
      });
      totals.registrations += bound.registrations;
      totals.members += bound.members;
    }
    return totals;
  }
}
