import { BadRequestException, NotFoundException } from '@nestjs/common';
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
    listCatalog: jest.fn(),
    getUnitWithBlock: jest.fn(),
    getActiveUnitLocation: jest.fn(),
    findBlockByName: jest.fn(),
    findUnitByName: jest.fn(),
    mergeUnits: jest.fn(),
  };
  const clientBlocks = { createBlock: jest.fn(), createUnit: jest.fn() };
  const review = {
    listUnlinkedPeople: jest.fn(),
    listLinkedPeople: jest.fn(),
    bindGroup: jest.fn(),
    unlinkUnit: jest.fn(),
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
    blocks.listCatalog.mockResolvedValue([
      {
        id: 'b-a',
        name: 'A',
        isActive: true,
        units: [{ id: 'u-101', name: '101', isActive: true }],
      },
    ]);
    review.listLinkedPeople.mockResolvedValue([
      {
        kind: 'registration',
        id: 'r2',
        name: 'Caio',
        faceId: 3,
        unitId: 'u-101',
        active: true,
      },
    ]);
    review.listUnlinkedPeople.mockResolvedValue([
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
        id: 'r3',
        name: 'Duda',
        faceId: 4,
        unitId: null,
        block: null,
        unit: '',
      },
    ]);

    const result = await service.getClientReview(user, clientId);

    expect(result.summary).toEqual({
      linked: 1,
      linkedGroups: 1,
      textOnly: 2,
      noLocation: 1,
    });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      registrations: 1,
      members: 1,
      suggestion: { unitId: 'u-101', exact: true },
    });
    expect(result.noLocation.people.map((p) => p.id)).toEqual(['r3']);
  });

  it('agrupa vinculados pela unidade e sugere outra unidade, nunca a própria', async () => {
    blocks.listCatalog.mockResolvedValue([
      {
        id: 'b-b',
        name: 'B',
        isActive: true,
        units: [
          { id: 'u-b601', name: '601', isActive: true },
          { id: 'u-b602', name: '602', isActive: true },
        ],
      },
      {
        id: 'b-bloco-b',
        name: 'Bloco b',
        isActive: true,
        units: [{ id: 'u-x601', name: '601', isActive: true }],
      },
      {
        id: 'b-old',
        name: 'Cond. Errado',
        isActive: false,
        units: [{ id: 'u-old', name: '235', isActive: false }],
      },
    ]);
    review.listUnlinkedPeople.mockResolvedValue([]);
    review.listLinkedPeople.mockResolvedValue([
      {
        kind: 'registration',
        id: 'r1',
        name: 'Ana',
        faceId: 1,
        unitId: 'u-x601',
        active: true,
      },
      {
        kind: 'member',
        id: 'm1',
        name: 'Renata',
        faceId: 2,
        unitId: 'u-old',
        active: false,
      },
      {
        kind: 'registration',
        id: 'r2',
        name: 'Bia',
        faceId: 3,
        unitId: 'u-b601',
        active: true,
      },
      {
        kind: 'registration',
        id: 'r3',
        name: 'Caio',
        faceId: 4,
        unitId: 'u-b602',
        active: true,
      },
    ]);

    const result = await service.getClientReview(user, clientId);
    const byUnit = Object.fromEntries(
      result.linkedGroups.map((group) => [group.unitId, group]),
    );

    expect(result.summary.linked).toBe(3);
    expect(byUnit['u-x601'].suggestion).toMatchObject({
      unitId: 'u-b601',
      exact: false,
    });
    expect(byUnit['u-b601'].suggestion).toMatchObject({ unitId: 'u-x601' });
    expect(byUnit['u-b602'].suggestion).toBeNull();
    expect(byUnit['u-old']).toMatchObject({
      blockActive: false,
      unitActive: false,
      inactive: 1,
      members: 1,
    });
    expect(result.linkedGroups.at(-1)?.unitId).toBe('u-b602');
  });

  it('move recusa origem igual ao destino e destino inativo', async () => {
    blocks.getUnitWithBlock.mockResolvedValue({ unit: { id: 'u-1' } });
    const source = '00000000-0000-4000-8000-000000000001';
    await expect(
      service.moveGroups(user, clientId, [
        { sourceUnitId: source, targetUnitId: source },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);

    blocks.getActiveUnitLocation.mockResolvedValue(null);
    await expect(
      service.moveGroups(user, clientId, [
        { sourceUnitId: source, targetUnitId: 'u-inativa' },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(blocks.mergeUnits).not.toHaveBeenCalled();
  });

  it('move recusa origem de outro cliente', async () => {
    blocks.getUnitWithBlock.mockResolvedValue(null);
    await expect(
      service.moveGroups(user, clientId, [
        { sourceUnitId: 'u-1', targetUnitId: null },
      ]),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(review.unlinkUnit).not.toHaveBeenCalled();
  });

  it('move com os nomes do destino e desvincula quando o destino é nulo', async () => {
    blocks.getUnitWithBlock.mockResolvedValue({ unit: { id: 'u-1' } });
    blocks.getActiveUnitLocation.mockResolvedValue({
      unitId: 'u-b601',
      blockId: 'b-b',
      blockName: 'B',
      unitName: '601',
    });

    const result = await service.moveGroups(user, clientId, [
      { sourceUnitId: 'u-x601', targetUnitId: 'u-b601' },
      { sourceUnitId: 'u-old', targetUnitId: null },
    ]);

    expect(blocks.mergeUnits).toHaveBeenCalledWith({
      sourceUnitId: 'u-x601',
      targetUnitId: 'u-b601',
      blockName: 'B',
      unitName: '601',
    });
    expect(review.unlinkUnit).toHaveBeenCalledWith(clientId, 'u-old');
    expect(result).toEqual({ moved: 1, unlinked: 1 });
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
});
