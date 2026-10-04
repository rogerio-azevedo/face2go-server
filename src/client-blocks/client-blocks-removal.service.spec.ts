import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { ClientBlocksRemovalRepository } from './client-blocks-removal.repository';
import { ClientBlocksRemovalService } from './client-blocks-removal.service';
import { ClientBlocksRepository } from './client-blocks.repository';
import { CondominiumAccessService } from './condominium-access.service';
import { LocationReviewRepository } from './location-review.repository';

const user = { role: 'client_admin', clientId: 'client-1' } as never;
const clientId = 'client-1';

describe('ClientBlocksRemovalService', () => {
  const access = { assertManage: jest.fn(), assertRead: jest.fn() };
  const blocks = { getBlock: jest.fn(), getUnitWithBlock: jest.fn() };
  const removal = {
    listUnitIds: jest.fn(),
    countUnitReferences: jest.fn(),
    deleteUnit: jest.fn(),
    deleteBlock: jest.fn(),
  };
  const review = { listLinkedPeople: jest.fn() };

  let service: ClientBlocksRemovalService;

  beforeEach(async () => {
    jest.clearAllMocks();
    access.assertManage.mockResolvedValue({ id: clientId });
    const module = await Test.createTestingModule({
      providers: [
        ClientBlocksRemovalService,
        { provide: CondominiumAccessService, useValue: access },
        { provide: ClientBlocksRepository, useValue: blocks },
        { provide: ClientBlocksRemovalRepository, useValue: removal },
        { provide: LocationReviewRepository, useValue: review },
      ],
    }).compile();
    service = module.get(ClientBlocksRemovalService);
  });

  it('lista as pessoas da unidade, inclusive inativas', async () => {
    blocks.getUnitWithBlock.mockResolvedValue({ unit: { id: 'unit-1' } });
    review.listLinkedPeople.mockResolvedValue([
      {
        kind: 'registration',
        id: 'r1',
        name: 'Juliana',
        faceId: null,
        unitId: 'unit-1',
        active: true,
      },
    ]);

    const people = await service.listUnitPeople(user, clientId, 'unit-1');

    expect(access.assertRead).toHaveBeenCalledWith(user, clientId);
    expect(review.listLinkedPeople).toHaveBeenCalledWith(clientId, 'unit-1');
    expect(people).toEqual([
      {
        kind: 'registration',
        id: 'r1',
        name: 'Juliana',
        faceId: null,
        active: true,
      },
    ]);
  });

  it('não lista pessoas de unidade de outro cliente', async () => {
    blocks.getUnitWithBlock.mockResolvedValue(null);
    await expect(
      service.listUnitPeople(user, clientId, 'unit-x'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(review.listLinkedPeople).not.toHaveBeenCalled();
  });

  it('exclui unidade inativa sem vínculos', async () => {
    blocks.getUnitWithBlock.mockResolvedValue({
      unit: { id: 'unit-1', isActive: false },
      block: { id: 'block-1', isActive: true },
    });
    removal.countUnitReferences.mockResolvedValue(0);

    await expect(service.deleteUnit(user, clientId, 'unit-1')).resolves.toEqual(
      { deleted: true },
    );
    expect(removal.deleteUnit).toHaveBeenCalledWith(clientId, 'unit-1');
  });

  it('não exclui unidade ativa', async () => {
    blocks.getUnitWithBlock.mockResolvedValue({
      unit: { id: 'unit-1', isActive: true },
      block: { id: 'block-1', isActive: true },
    });
    await expect(
      service.deleteUnit(user, clientId, 'unit-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(removal.deleteUnit).not.toHaveBeenCalled();
  });

  it('não exclui unidade com pessoas vinculadas, mesmo inativas', async () => {
    blocks.getUnitWithBlock.mockResolvedValue({
      unit: { id: 'unit-1', isActive: false },
      block: { id: 'block-1', isActive: false },
    });
    removal.countUnitReferences.mockResolvedValue(1);
    await expect(
      service.deleteUnit(user, clientId, 'unit-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(removal.deleteUnit).not.toHaveBeenCalled();
  });

  it('exclui bloco inativo sem vínculos nas unidades', async () => {
    blocks.getBlock.mockResolvedValue({ id: 'block-1', isActive: false });
    removal.listUnitIds.mockResolvedValue(['unit-1', 'unit-2']);
    removal.countUnitReferences.mockResolvedValue(0);

    await expect(
      service.deleteBlock(user, clientId, 'block-1'),
    ).resolves.toEqual({ deleted: true });
    expect(removal.countUnitReferences).toHaveBeenCalledWith([
      'unit-1',
      'unit-2',
    ]);
    expect(removal.deleteBlock).toHaveBeenCalledWith(clientId, 'block-1');
  });

  it('não exclui bloco ativo', async () => {
    blocks.getBlock.mockResolvedValue({ id: 'block-1', isActive: true });
    await expect(
      service.deleteBlock(user, clientId, 'block-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(removal.deleteBlock).not.toHaveBeenCalled();
  });

  it('não exclui bloco com pessoas em alguma unidade', async () => {
    blocks.getBlock.mockResolvedValue({ id: 'block-1', isActive: false });
    removal.listUnitIds.mockResolvedValue(['unit-1']);
    removal.countUnitReferences.mockResolvedValue(2);
    await expect(
      service.deleteBlock(user, clientId, 'block-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(removal.deleteBlock).not.toHaveBeenCalled();
  });

  it('devolve 404 para bloco de outro cliente', async () => {
    blocks.getBlock.mockResolvedValue(null);
    await expect(
      service.deleteBlock(user, clientId, 'block-x'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
