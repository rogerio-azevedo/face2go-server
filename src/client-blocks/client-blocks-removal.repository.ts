import { Injectable } from '@nestjs/common';
import { and, count, eq, inArray } from 'drizzle-orm';

import { DatabaseService } from '../database/database.service';
import {
  clientBlocks,
  clientMembers,
  clientUnits,
  registrations,
} from '../database/schema';

@Injectable()
export class ClientBlocksRemovalRepository {
  constructor(private readonly database: DatabaseService) {}

  async listUnitIds(clientId: string, blockId: string) {
    const rows = await this.database.db
      .select({ id: clientUnits.id })
      .from(clientUnits)
      .where(
        and(
          eq(clientUnits.clientId, clientId),
          eq(clientUnits.blockId, blockId),
        ),
      );
    return rows.map((row) => row.id);
  }

  /** Conta qualquer vínculo (ativo ou não): a FK impede apagar unidade referenciada. */
  async countUnitReferences(unitIds: string[]) {
    if (unitIds.length === 0) return 0;
    const [registrationsRow, membersRow] = await Promise.all([
      this.database.db
        .select({ total: count() })
        .from(registrations)
        .where(inArray(registrations.unitId, unitIds)),
      this.database.db
        .select({ total: count() })
        .from(clientMembers)
        .where(inArray(clientMembers.unitId, unitIds)),
    ]);
    return (
      Number(registrationsRow[0]?.total ?? 0) +
      Number(membersRow[0]?.total ?? 0)
    );
  }

  async deleteUnit(clientId: string, unitId: string) {
    const rows = await this.database.db
      .delete(clientUnits)
      .where(
        and(eq(clientUnits.id, unitId), eq(clientUnits.clientId, clientId)),
      )
      .returning({ id: clientUnits.id });
    return rows.length > 0;
  }

  async deleteBlock(clientId: string, blockId: string) {
    return this.database.db.transaction(async (tx) => {
      await tx
        .delete(clientUnits)
        .where(
          and(
            eq(clientUnits.blockId, blockId),
            eq(clientUnits.clientId, clientId),
          ),
        );
      const rows = await tx
        .delete(clientBlocks)
        .where(
          and(
            eq(clientBlocks.id, blockId),
            eq(clientBlocks.clientId, clientId),
          ),
        )
        .returning({ id: clientBlocks.id });
      return rows.length > 0;
    });
  }
}
