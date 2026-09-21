import { createdAtRangeFilter } from '../common/parse-access-list-datetime';
import type { AccessPersonIdsByLocation } from './find-access-person-ids-by-location';

export type FacialAccessListQuery = {
  companyId: string;
  clientId?: string;
  startDate?: string;
  endDate?: string;
  name?: string;
  readerId?: string;
  timezoneOffsetMinutes?: number;
};

function escapeMongoRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Monta o filtro Mongo da listagem.
 * `null` = nenhum documento (bloco/unidade sem pessoas correspondentes).
 */
export function buildFacialAccessMongoFilter(
  query: FacialAccessListQuery,
  locationIds?: AccessPersonIdsByLocation,
): Record<string, unknown> | null {
  const filter: Record<string, unknown> = {
    companyId: query.companyId,
  };
  if (query.clientId) {
    filter.clientId = query.clientId;
  }
  const readerId = query.readerId?.trim();
  if (readerId) {
    filter.readerId = readerId;
  }

  const createdAt = createdAtRangeFilter(
    query.startDate,
    query.endDate,
    query.timezoneOffsetMinutes ?? 0,
  );
  if (createdAt) {
    filter.createdAt = createdAt;
  }

  const name = query.name?.trim();
  if (name) {
    filter.personName = {
      $regex: escapeMongoRegex(name),
      $options: 'i',
    };
  }

  if (locationIds) {
    const or: Record<string, unknown>[] = [];
    if (locationIds.memberIds.length > 0) {
      or.push({
        personType: 'member',
        personId: { $in: locationIds.memberIds },
      });
    }
    if (locationIds.registrationIds.length > 0) {
      or.push({
        personType: 'guest',
        personId: { $in: locationIds.registrationIds },
      });
    }
    if (or.length === 0) {
      return null;
    }
    if (or.length === 1) {
      Object.assign(filter, or[0]);
    } else {
      filter.$or = or;
    }
  }

  return filter;
}
