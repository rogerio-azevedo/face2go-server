import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import type {
  BindLocationGroupInput,
  EnsureLocationUnitInput,
} from '../validation/client-blocks.schema';
import { ClientBlocksRepository } from './client-blocks.repository';
import { ClientBlocksService } from './client-blocks.service';
import { CondominiumAccessService } from './condominium-access.service';
import { collapseText, suggestUnit, textKey } from './location-match';
import {
  LocationReviewRepository,
  type LocationPersonRow,
} from './location-review.repository';

const MAX_PEOPLE_PER_GROUP = 100;

type ReviewPerson = Pick<LocationPersonRow, 'kind' | 'id' | 'name' | 'faceId'>;

type ReviewBucket = {
  registrations: number;
  members: number;
  people: ReviewPerson[];
};

function emptyBucket(): ReviewBucket {
  return { registrations: 0, members: 0, people: [] };
}

function addPerson(bucket: ReviewBucket, row: LocationPersonRow) {
  if (row.kind === 'registration') bucket.registrations += 1;
  else bucket.members += 1;
  if (bucket.people.length < MAX_PEOPLE_PER_GROUP) {
    bucket.people.push({
      kind: row.kind,
      id: row.id,
      name: row.name,
      faceId: row.faceId,
    });
  }
}

function compareText(a: string, b: string) {
  return a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });
}

@Injectable()
export class LocationReviewService {
  constructor(
    private readonly access: CondominiumAccessService,
    private readonly blocks: ClientBlocksRepository,
    private readonly clientBlocks: ClientBlocksService,
    private readonly review: LocationReviewRepository,
  ) {}

  async listCondominiums(user: JwtPayload) {
    const companyId = user.companyId;
    if (user.role !== 'company_admin' || !companyId) {
      throw new ForbiddenException('Sem permissão.');
    }
    const condominiums = await this.review.listCondominiums(companyId);
    const [counts, units] = await Promise.all([
      this.review.countLocationsByCompany(companyId),
      this.review.countActiveUnitsByClient(condominiums.map((c) => c.id)),
    ]);
    const countsByClient = new Map(counts.map((row) => [row.clientId, row]));
    return condominiums.map((client) => {
      const row = countsByClient.get(client.id);
      return {
        clientId: client.id,
        name: client.name,
        isActive: client.isActive,
        activeUnits: units.get(client.id) ?? 0,
        linked: row?.linked ?? 0,
        textOnly: row?.textOnly ?? 0,
        noLocation: row?.noLocation ?? 0,
        groups: row?.groups ?? 0,
      };
    });
  }

  async getClientReview(user: JwtPayload, clientId: string) {
    const client = await this.access.assertRead(user, clientId);
    const [catalog, people] = await Promise.all([
      this.blocks.listActiveCatalog(clientId),
      this.review.listPeople(clientId),
    ]);

    let linked = 0;
    const noLocation = emptyBucket();
    const groups = new Map<
      string,
      ReviewBucket & { blockText: string; unitText: string }
    >();

    for (const row of people) {
      if (row.unitId) {
        linked += 1;
        continue;
      }
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
        suggestion: suggestUnit(catalog, group.blockText, group.unitText),
      }))
      .sort(
        (a, b) =>
          compareText(a.blockText, b.blockText) ||
          compareText(a.unitText, b.unitText),
      );

    return {
      client: { id: client.id, name: client.name },
      catalog,
      summary: {
        linked,
        textOnly: groupList.reduce(
          (total, group) => total + group.registrations + group.members,
          0,
        ),
        noLocation: noLocation.registrations + noLocation.members,
      },
      groups: groupList,
      noLocation,
    };
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
