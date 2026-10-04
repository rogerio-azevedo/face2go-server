import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { ClientBlocksRepository } from './client-blocks.repository';
import {
  ClientBlocksService,
  floorUnitNames,
  structureBlockNames,
} from './client-blocks.service';
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
    findUnitByName: jest.fn(),
    generateStructure: jest.fn(),
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

  it('gera as unidades por andar e pula as que já existem', async () => {
    blocks.getBlock.mockResolvedValue({
      id: blockId,
      name: 'A',
      isActive: true,
    });
    blocks.listUnitNames.mockResolvedValue(['101', '103']);
    blocks.insertUnits.mockResolvedValue([]);

    const result = await service.generateUnits(user, clientId, blockId, {
      floorStart: 1,
      floorEnd: 2,
      unitsPerFloor: 2,
    });

    expect(result).toEqual({ created: 3, skipped: 1 });
    expect(blocks.insertUnits).toHaveBeenCalledWith(clientId, blockId, [
      '102',
      '201',
      '202',
    ]);
  });

  it('monta nomes de blocos com zeros e unidades por andar', () => {
    expect(
      structureBlockNames({ blockStart: 1, blockEnd: 3, blockDigits: 2 }),
    ).toEqual(['01', '02', '03']);
    const units = floorUnitNames({
      floorStart: 1,
      floorEnd: 4,
      unitsPerFloor: 4,
    });
    expect(units).toHaveLength(16);
    expect(units.slice(0, 5)).toEqual(['101', '102', '103', '104', '201']);
    expect(units.at(-1)).toBe('404');
  });

  it('gera a estrutura do condomínio inteiro', async () => {
    blocks.generateStructure.mockResolvedValue({
      blocksCreated: 0,
      unitsCreated: 433,
      unitsSkipped: 255,
      inactiveBlocksSkipped: [],
    });

    await service.generateStructure(user, clientId, {
      blockStart: 1,
      blockEnd: 43,
      blockDigits: 2,
      floorStart: 1,
      floorEnd: 4,
      unitsPerFloor: 4,
    });

    const [, blockNames, unitNames] = blocks.generateStructure.mock
      .calls[0] as [string, string[], string[]];
    expect(blockNames).toHaveLength(43);
    expect(blockNames[0]).toBe('01');
    expect(blockNames[42]).toBe('43');
    expect(unitNames).toHaveLength(16);
  });

  it('recusa estrutura acima do limite de unidades', async () => {
    await expect(
      service.generateStructure(user, clientId, {
        blockStart: 1,
        blockEnd: 200,
        blockDigits: 3,
        floorStart: 1,
        floorEnd: 30,
        unitsPerFloor: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(blocks.generateStructure).not.toHaveBeenCalled();
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
});
