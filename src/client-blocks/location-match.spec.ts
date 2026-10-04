import type { CatalogBlock } from './client-blocks.repository';
import { looseKey, suggestUnit } from './location-match';

const catalog: CatalogBlock[] = [
  {
    id: 'b-a',
    name: 'A',
    isActive: true,
    isAdministrative: false,
    units: [
      { id: 'u-a101', name: '101', isActive: true },
      { id: 'u-a102', name: '102', isActive: false },
    ],
  },
  {
    id: 'b-b',
    name: 'B',
    isActive: true,
    isAdministrative: false,
    units: [{ id: 'u-b101', name: '101', isActive: true }],
  },
  {
    id: 'b-old',
    name: 'Velho',
    isActive: false,
    isAdministrative: false,
    units: [{ id: 'u-old', name: '1', isActive: true }],
  },
];

describe('location-match', () => {
  it('remove prefixos, acentos e zeros à esquerda', () => {
    expect(looseKey('Bloco A')).toBe('a');
    expect(looseKey('Apto. 0101')).toBe('101');
    expect(looseKey(' Torre  2 ')).toBe('2');
  });

  it('sugere a unidade exata ignorando caixa e espaços', () => {
    expect(suggestUnit(catalog, ' a ', '101')).toMatchObject({
      unitId: 'u-a101',
      exact: true,
    });
  });

  it('sugere por chave tolerante quando há uma única candidata', () => {
    expect(suggestUnit(catalog, 'Bloco B', 'Apto 101')).toMatchObject({
      unitId: 'u-b101',
      exact: false,
    });
  });

  it('não sugere quando o texto é ambíguo, inativo ou vazio', () => {
    expect(suggestUnit(catalog, '', '101')).toBeNull();
    expect(suggestUnit(catalog, 'A', '102')).toBeNull();
    expect(suggestUnit(catalog, 'Velho', '1')).toBeNull();
    expect(suggestUnit(catalog, 'A', '')).toBeNull();
  });
});
