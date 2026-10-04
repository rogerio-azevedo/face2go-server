import type { CatalogBlock } from './client-blocks.repository';
import type { createUnitSuggester } from './location-match';
import type {
  LinkedPersonRow,
  LocationPersonRow,
} from './location-review.repository';

const MAX_PEOPLE_PER_GROUP = 100;

type ReviewPerson = Pick<
  LocationPersonRow,
  'kind' | 'id' | 'name' | 'faceId'
> & { active?: boolean };

export type ReviewBucket = {
  registrations: number;
  members: number;
  people: ReviewPerson[];
};

export function emptyBucket(): ReviewBucket {
  return { registrations: 0, members: 0, people: [] };
}

export function addPerson(
  bucket: ReviewBucket,
  row: Pick<LocationPersonRow, 'kind' | 'id' | 'name' | 'faceId'> & {
    active?: boolean;
  },
) {
  if (row.kind === 'registration') bucket.registrations += 1;
  else bucket.members += 1;
  if (bucket.people.length < MAX_PEOPLE_PER_GROUP) {
    bucket.people.push({
      kind: row.kind,
      id: row.id,
      name: row.name,
      faceId: row.faceId,
      ...(row.active === undefined ? {} : { active: row.active }),
    });
  }
}

export function compareText(a: string, b: string) {
  return a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });
}

export function activeCatalog(catalog: CatalogBlock[]): CatalogBlock[] {
  return catalog
    .filter((block) => block.isActive)
    .map((block) => ({
      ...block,
      units: block.units.filter((unit) => unit.isActive),
    }));
}

/** Um grupo por unidade atual, com sugestão de outra unidade ativa. */
export function buildLinkedGroups(
  fullCatalog: CatalogBlock[],
  suggest: ReturnType<typeof createUnitSuggester>,
  people: LinkedPersonRow[],
) {
  const units = new Map(
    fullCatalog.flatMap((block) =>
      block.units.map((unit) => [unit.id, { block, unit }] as const),
    ),
  );
  const groups = new Map<string, ReviewBucket & { inactive: number }>();
  for (const row of people) {
    let group = groups.get(row.unitId);
    if (!group) {
      group = { ...emptyBucket(), inactive: 0 };
      groups.set(row.unitId, group);
    }
    if (!row.active) group.inactive += 1;
    addPerson(group, row);
  }

  return [...groups.entries()]
    .flatMap(([unitId, group]) => {
      const location = units.get(unitId);
      if (!location) return [];
      const { block, unit } = location;
      return [
        {
          key: unitId,
          unitId,
          blockName: block.name,
          unitName: unit.name,
          blockActive: block.isActive,
          unitActive: unit.isActive,
          ...group,
          suggestion: suggest(block.name, unit.name, unitId),
        },
      ];
    })
    .sort(
      (a, b) =>
        Number(needsReview(b)) - Number(needsReview(a)) ||
        compareText(a.blockName, b.blockName) ||
        compareText(a.unitName, b.unitName),
    );
}

function needsReview(group: {
  blockActive: boolean;
  unitActive: boolean;
  suggestion: unknown;
}) {
  return !group.blockActive || !group.unitActive || group.suggestion !== null;
}
