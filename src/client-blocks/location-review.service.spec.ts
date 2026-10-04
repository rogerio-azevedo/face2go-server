import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { ClientBlocksRepository } from './client-blocks.repository';
import { ClientBlocksService } from './client-blocks.service';
import { CondominiumAccessService } from './condominium-access.service';
import { LocationReviewRepository } from './location-review.repository';
import { LocationReviewService } from './location-review.service';

const user = { role: 'company_admin', companyId: 'company-1' } as never;
const clientId = 'client-1';

describe('LocationReviewService', () => {
  const access = {
    assertRead: jest.fn().mockResolvedValue({ id: clientId, name: 'Cond' }),
    assertManage: jest.fn().mockResolvedValue({ id: clientId }),
  };
  const blocks = {
    listActiveCatalog: jest.fn(),
    getActiveUnitLocation: jest.fn(),
    findBlockByName: jest.fn(),
    findUnitByName: jest.fn(),
  };
  const clientBlocks = { createBlock: jest.fn(), createUnit: jest.fn() };
  const review = {
    listPeople: jest.fn(),
    bindGroup: jest.fn(),
    listCondominiums: jest.fn(),
    countLocationsByCompany: jest.fn(),
    countActiveUnitsByClient: jest.fn(),
  };

  let service: LocationReviewService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        LocationReviewService,
        { provide: CondominiumAccessService, useValue: access },
        { provide: ClientBlocksRepository, useValue: blocks },
        { provide: ClientBlocksService, useValue: clientBlocks },
        { provide: LocationReviewRepository, useValue: review },
      ],
    }).compile();
    service = module.get(LocationReviewService);
  });

  it('agrupa pelo texto normalizado e sugere a unidade do catálogo', async () => {
    blocks.listActiveCatalog.mockResolvedValue([
      {
        id: 'b-a',
        name: 'A',
        isActive: true,
        units: [{ id: 'u-101', name: '101', isActive: true }],
      },
    ]);
    review.listPeople.mockResolvedValue([
      {
        kind: 'registration',
        id: 'r1',
        name: 'Ana',
        faceId: 1,
        unitId: null,
        block: 'a',
        unit: '101',
      },
      {
        kind: 'member',
        id: 'm1',
        name: 'Bia',
        faceId: 2,
        unitId: null,
        block: ' A ',
        unit: '101',
      },
      {
        kind: 'registration',
        id: 'r2',
        name: 'Caio',
        faceId: 3,
        unitId: 'u-101',
        block: 'A',
        unit: '101',
      },
      {
        kind: 'registration',
        id: 'r3',
        name: 'Duda',
        faceId: 4,
        unitId: null,
        block: null,
        unit: '',
      },
    ]);

    const result = await service.getClientReview(user, clientId);

    expect(result.summary).toEqual({ linked: 1, textOnly: 2, noLocation: 1 });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      registrations: 1,
      members: 1,
      suggestion: { unitId: 'u-101', exact: true },
    });
    expect(result.noLocation.people.map((p) => p.id)).toEqual(['r3']);
  });

  it('recusa vínculo com unidade inativa sem gravar nada', async () => {
    blocks.getActiveUnitLocation.mockResolvedValue(null);
    await expect(
      service.bindGroups(user, clientId, [
        { blockText: 'A', unitText: '101', unitId: 'u-x' },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(review.bindGroup).not.toHaveBeenCalled();
  });

  it('vincula com o nome canônico do catálogo e soma os totais', async () => {
    blocks.getActiveUnitLocation.mockResolvedValue({
      unitId: 'u-101',
      blockId: 'b-a',
      blockName: 'A',
      unitName: '101',
    });
    review.bindGroup.mockResolvedValue({ registrations: 2, members: 1 });

    const result = await service.bindGroups(user, clientId, [
      { blockText: 'bloco a', unitText: 'apto 101', unitId: 'u-101' },
      { blockText: 'A', unitText: '101', unitId: 'u-101' },
    ]);

    expect(review.bindGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        blockText: 'bloco a',
        blockName: 'A',
        unitName: '101',
      }),
    );
    expect(result).toEqual({ registrations: 4, members: 2 });
  });

  it('usa bloco e unidade existentes antes de criar', async () => {
    blocks.findBlockByName.mockResolvedValue({
      id: 'b-a',
      name: 'A',
      isActive: true,
    });
    blocks.findUnitByName.mockResolvedValue(null);
    clientBlocks.createUnit.mockResolvedValue({ id: 'u-new', name: '201' });

    const result = await service.ensureUnit(user, clientId, {
      blockName: 'a',
      unitName: '201',
    });

    expect(clientBlocks.createBlock).not.toHaveBeenCalled();
    expect(result).toEqual({
      blockId: 'b-a',
      blockName: 'A',
      unitId: 'u-new',
      unitName: '201',
    });
  });

  it('só company_admin vê o resumo da empresa', async () => {
    await expect(
      service.listCondominiums({ role: 'client_admin', clientId } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
