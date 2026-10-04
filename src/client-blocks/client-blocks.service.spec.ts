import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { ClientBlocksRepository } from './client-blocks.repository';
import { ClientBlocksService } from './client-blocks.service';
import { CondominiumAccessService } from './condominium-access.service';

const user = { role: 'client_admin', clientId: 'client-1' } as never;
const clientId = 'client-1';
const blockId = 'block-1';

describe('ClientBlocksService', () => {
  const access = {
    assertRead: jest.fn().mockResolvedValue({ id: clientId }),
    assertManage: jest.fn().mockResolvedValue({ id: clientId }),
  };
  const blocks = {
    getBlock: jest.fn(),
    listUnitNames: jest.fn(),
    insertUnits: jest.fn(),
    findBlockByName: jest.fn(),
    insertBlock: jest.fn(),
    countActiveUnitsInBlock: jest.fn(),
    updateBlock: jest.fn(),
    countActiveOccupants: jest.fn(),
    getUnitWithBlock: jest.fn(),
    updateUnit: jest.fn(),
    mergeUnits: jest.fn(),
    findUnitByName: jest.fn(),
  };

  let service: ClientBlocksService;

  beforeEach(async () => {
    jest.clearAllMocks();
    access.assertManage.mockResolvedValue({ id: clientId });
    const module = await Test.createTestingModule({
      providers: [
        ClientBlocksService,
        { provide: CondominiumAccessService, useValue: access },
        { provide: ClientBlocksRepository, useValue: blocks },
      ],
    }).compile();
    service = module.get(ClientBlocksService);
  });

  it('recusa bloco com o mesmo nome', async () => {
    blocks.findBlockByName.mockResolvedValue({
      id: 'other',
      name: 'A',
      isActive: true,
    });
    await expect(
      service.createBlock(user, clientId, { name: 'A' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(blocks.insertBlock).not.toHaveBeenCalled();
  });

  it('gera o intervalo e pula unidades que já existem', async () => {
    blocks.getBlock.mockResolvedValue({
      id: blockId,
      name: 'A',
      isActive: true,
    });
    blocks.listUnitNames.mockResolvedValue(['101', '103']);
    blocks.insertUnits.mockResolvedValue([]);

    const result = await service.generateUnits(user, clientId, blockId, {
      start: 101,
      end: 104,
    });

    expect(result).toEqual({ created: 2, skipped: 2 });
    expect(blocks.insertUnits).toHaveBeenCalledWith(clientId, blockId, [
      '102',
      '104',
    ]);
  });

  it('não desativa bloco que ainda tem unidades ativas', async () => {
    blocks.getBlock.mockResolvedValue({
      id: blockId,
      name: 'A',
      isActive: true,
    });
    blocks.countActiveUnitsInBlock.mockResolvedValue(3);
    await expect(
      service.updateBlock(user, clientId, blockId, { isActive: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(blocks.updateBlock).not.toHaveBeenCalled();
  });

  it('não desativa unidade com pessoas vinculadas', async () => {
    blocks.getUnitWithBlock.mockResolvedValue({
      unit: { id: 'unit-1', name: '101', isActive: true },
      block: { id: blockId, name: 'A', isActive: true },
    });
    blocks.countActiveOccupants.mockResolvedValue(2);
    await expect(
      service.updateUnit(user, clientId, 'unit-1', { isActive: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(blocks.updateUnit).not.toHaveBeenCalled();
  });

  it('une a origem no destino e desativa a origem', async () => {
    blocks.getUnitWithBlock.mockImplementation(
      async (_client: string, unitId: string) => {
        if (unitId === 'source') {
          return {
            unit: { id: 'source', name: '101-A', isActive: true },
            block: { id: blockId, name: 'A', isActive: true },
          };
        }
        return {
          unit: { id: 'target', name: '101', isActive: true },
          block: { id: blockId, name: 'A', isActive: true },
        };
      },
    );
    blocks.mergeUnits.mockResolvedValue(undefined);

    await service.mergeUnit(user, clientId, 'source', 'target');

    expect(blocks.mergeUnits).toHaveBeenCalledWith({
      sourceUnitId: 'source',
      targetUnitId: 'target',
      blockName: 'A',
      unitName: '101',
    });
  });
});
