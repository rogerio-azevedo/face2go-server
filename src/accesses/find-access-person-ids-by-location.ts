import { and, eq, sql, type SQL } from 'drizzle-orm';

import type { AppDb } from '../database/database.types';
import { clientMembers, clients, registrations } from '../database/schema';

export type AccessPersonIdsByLocation = {
  memberIds: string[];
  registrationIds: string[];
};

function additionalDataFieldEquals(
  column:
    typeof clientMembers.additionalData | typeof registrations.additionalData,
  key: 'block' | 'unit',
  value?: string,
): SQL | undefined {
  const term = value?.trim();
  if (!term) return undefined;
  if (key === 'block') {
    return sql`coalesce(${column}->>'block', '') ilike ${term}`;
  }
  return sql`coalesce(${column}->>'unit', '') ilike ${term}`;
}

export async function findAccessPersonIdsByLocation(
  db: AppDb,
  options: {
    companyId: string;
    clientId?: string;
    block?: string;
    unit?: string;
  },
): Promise<AccessPersonIdsByLocation> {
  const block = options.block?.trim();
  const unit = options.unit?.trim();
  if (!block && !unit) {
    return { memberIds: [], registrationIds: [] };
  }

  const memberConds: SQL[] = [eq(clients.companyId, options.companyId)];
  if (options.clientId) {
    memberConds.push(eq(clientMembers.clientId, options.clientId));
  }
  const memberBlock = additionalDataFieldEquals(
    clientMembers.additionalData,
    'block',
    block,
  );
  if (memberBlock) memberConds.push(memberBlock);
  const memberUnit = additionalDataFieldEquals(
    clientMembers.additionalData,
    'unit',
    unit,
  );
  if (memberUnit) memberConds.push(memberUnit);

  const registrationConds: SQL[] = [eq(clients.companyId, options.companyId)];
  if (options.clientId) {
    registrationConds.push(eq(registrations.clientId, options.clientId));
  }
  const registrationBlock = additionalDataFieldEquals(
    registrations.additionalData,
    'block',
    block,
  );
  if (registrationBlock) registrationConds.push(registrationBlock);
  const registrationUnit = additionalDataFieldEquals(
    registrations.additionalData,
    'unit',
    unit,
  );
  if (registrationUnit) registrationConds.push(registrationUnit);

  const [memberRows, registrationRows] = await Promise.all([
    db
      .select({ id: clientMembers.id })
      .from(clientMembers)
      .innerJoin(clients, eq(clients.id, clientMembers.clientId))
      .where(and(...memberConds)),
    db
      .select({ id: registrations.id })
      .from(registrations)
      .innerJoin(clients, eq(clients.id, registrations.clientId))
      .where(and(...registrationConds)),
  ]);

  return {
    memberIds: memberRows.map((row) => row.id),
    registrationIds: registrationRows.map((row) => row.id),
  };
}
