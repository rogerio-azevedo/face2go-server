import { BadRequestException } from '@nestjs/common';

import { defaultConfigForClientType } from './registration-fields-config';
import {
  EMPTY_CATALOG_MESSAGE,
  resolveCondominiumUnit,
  UNIT_INVALID_MESSAGE,
  UNIT_REQUIRED_MESSAGE,
} from './resolve-condominium-unit';

const config = defaultConfigForClientType('condominium');

describe('resolveCondominiumUnit', () => {
  it('exige unidade e avisa quando o catálogo está vazio', async () => {
    await expect(
      resolveCondominiumUnit({
        clientType: 'condominium',
        config,
        requestedUnitId: null,
        additionalData: { block: 'A', unit: '101' },
        catalog: {
          loadActiveUnit: async () => null,
          countActiveUnits: async () => 0,
        },
      }),
    ).rejects.toThrow(new BadRequestException(EMPTY_CATALOG_MESSAGE));
  });

  it('exige unidade quando o catálogo já tem itens', async () => {
    await expect(
      resolveCondominiumUnit({
        clientType: 'condominium',
        config,
        requestedUnitId: undefined,
        additionalData: null,
        catalog: {
          loadActiveUnit: async () => null,
          countActiveUnits: async () => 2,
        },
      }),
    ).rejects.toThrow(new BadRequestException(UNIT_REQUIRED_MESSAGE));
  });

  it('rejeita unidade de outro cliente ou inativa', async () => {
    await expect(
      resolveCondominiumUnit({
        clientType: 'condominium',
        config,
        requestedUnitId: 'unit-outro',
        additionalData: { block: 'Texto livre', unit: '99' },
        catalog: {
          loadActiveUnit: async () => null,
          countActiveUnits: async () => 1,
        },
      }),
    ).rejects.toThrow(new BadRequestException(UNIT_INVALID_MESSAGE));
  });

  it('grava os nomes do catálogo e ignora o texto enviado', async () => {
    const result = await resolveCondominiumUnit({
      clientType: 'condominium',
      config,
      requestedUnitId: 'unit-1',
      additionalData: { block: 'Bloco A', unit: 'apto 101', room: 'x' },
      catalog: {
        loadActiveUnit: async () => ({ blockName: 'A', unitName: '101' }),
        countActiveUnits: async () => 1,
      },
    });
    expect(result).toEqual({
      unitId: 'unit-1',
      additionalData: { room: 'x', block: 'A', unit: '101' },
    });
  });

  it('não mexe em cliente que não é condomínio', async () => {
    const result = await resolveCondominiumUnit({
      clientType: 'office',
      config: defaultConfigForClientType('office'),
      requestedUnitId: 'unit-1',
      additionalData: { room: '12' },
      catalog: {
        loadActiveUnit: async () => ({ blockName: 'A', unitName: '101' }),
        countActiveUnits: async () => 1,
      },
    });
    expect(result.unitId).toBeNull();
    expect(result.additionalData).toEqual({ room: '12' });
  });
});
