import type { CatalogBlock } from './client-blocks.repository';

export type UnitSuggestion = {
  unitId: string;
  blockId: string;
  blockName: string;
  unitName: string;
  exact: boolean;
};

const PREFIX_WORDS = new Set([
  'bloco',
  'blk',
  'bl',
  'torre',
  'tr',
  'quadra',
  'qd',
  'apartamento',
  'apto',
  'apt',
  'ap',
  'unidade',
  'und',
  'un',
  'casa',
  'cs',
  'lote',
  'lt',
  'sala',
  'sl',
]);

export function collapseText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

export function textKey(value: unknown): string {
  return collapseText(value).toLowerCase();
}

/** Chave tolerante: sem acento, sem prefixos ("Bloco", "Apto") e sem zeros à esquerda. */
export function looseKey(value: unknown): string {
  return collapseText(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !PREFIX_WORDS.has(token))
    .map((token) => (/^\d+$/.test(token) ? String(Number(token)) : token))
    .join('');
}

/** Pré-calcula as chaves do catálogo ativo para sugerir várias vezes. */
export function createUnitSuggester(catalog: CatalogBlock[]) {
  const units = catalog
    .filter((block) => block.isActive)
    .flatMap((block) =>
      block.units
        .filter((unit) => unit.isActive)
        .map((unit) => ({
          location: {
            unitId: unit.id,
            blockId: block.id,
            blockName: block.name,
            unitName: unit.name,
          },
          blockKey: textKey(block.name),
          unitKey: textKey(unit.name),
          looseBlock: looseKey(block.name),
          looseUnit: looseKey(unit.name),
        })),
    );

  return (
    blockText: unknown,
    unitText: unknown,
    excludeUnitId?: string,
  ): UnitSuggestion | null => {
    const blockKey = textKey(blockText);
    const unitKey = textKey(unitText);
    if (!unitKey) return null;
    const pool = excludeUnitId
      ? units.filter((unit) => unit.location.unitId !== excludeUnitId)
      : units;

    const exact = pool.find(
      (unit) => unit.blockKey === blockKey && unit.unitKey === unitKey,
    );
    if (exact) return { ...exact.location, exact: true };

    const looseBlock = looseKey(blockText);
    const looseUnit = looseKey(unitText);
    if (!looseUnit) return null;
    const candidates = pool.filter(
      (unit) =>
        unit.looseUnit === looseUnit &&
        (!looseBlock || unit.looseBlock === looseBlock),
    );
    return candidates.length === 1
      ? { ...candidates[0].location, exact: false }
      : null;
  };
}

export function suggestUnit(
  catalog: CatalogBlock[],
  blockText: unknown,
  unitText: unknown,
): UnitSuggestion | null {
  return createUnitSuggester(catalog)(blockText, unitText);
}
