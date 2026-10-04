import { and, eq, type SQL } from 'drizzle-orm';

import type { AppDb } from '../database/database.types';
import {
  clientMembers,
  clientUnits,
  clients,
  registrations,
} from '../database/schema';

export type AccessPersonIdsByLocation = {
  memberIds: string[];
  registrationIds: string[];
};

export async function findAccessPersonIdsByLocation(
  db: AppDb,
  options: {
    companyId: string;
    clientId?: string;
    blockId?: string;
    unitId?: string;
  },
): Promise<AccessPersonIdsByLocation> {
  const blockId = options.blockId?.trim();
  const unitId = options.unitId?.trim();
  if (!blockId && !unitId) {
    return { memberIds: [], registrationIds: [] };
  }

  const memberConds: SQL[] = [eq(clients.companyId, options.companyId)];
  if (options.clientId) {
    memberConds.push(eq(clientMembers.clientId, options.clientId));
  }
  if (unitId) memberConds.push(eq(clientUnits.id, unitId));
  if (blockId) memberConds.push(eq(clientUnits.blockId, blockId));

  const registrationConds: SQL[] = [eq(clients.companyId, options.companyId)];
  if (options.clientId) {
    registrationConds.push(eq(registrations.clientId, options.clientId));
  }
  if (unitId) registrationConds.push(eq(clientUnits.id, unitId));
  if (blockId) registrationConds.push(eq(clientUnits.blockId, blockId));

  const [memberRows, registrationRows] = await Promise.all([
    db
      .select({ id: clientMembers.id })
      .from(clientMembers)
      .innerJoin(clients, eq(clients.id, clientMembers.clientId))
      .innerJoin(clientUnits, eq(clientUnits.id, clientMembers.unitId))
      .where(and(...memberConds)),
    db
      .select({ id: registrations.id })
      .from(registrations)
      .innerJoin(clients, eq(clients.id, registrations.clientId))
      .innerJoin(clientUnits, eq(clientUnits.id, registrations.unitId))
      .where(and(...registrationConds)),
  ]);

  return {
    memberIds: memberRows.map((row) => row.id),
    registrationIds: registrationRows.map((row) => row.id),
  };
}
