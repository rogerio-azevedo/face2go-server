import { Injectable } from '@nestjs/common';
import { and, count, eq, inArray, sql } from 'drizzle-orm';

import { DatabaseService } from '../database/database.service';
import {
  clientBlocks,
  clientMembers,
  clientUnits,
  registrations,
} from '../database/schema';

export type ClientBlockRow = typeof clientBlocks.$inferSelect;
export type ClientUnitRow = typeof clientUnits.$inferSelect;

export type UnitWithBlock = {
  unit: ClientUnitRow;
  block: ClientBlockRow;
};

export type ActiveUnitLocation = {
  unitId: string;
  blockId: string;
  blockName: string;
  unitName: string;
  isAdministrative: boolean;
};

export type CatalogBlock = {
  id: string;
  name: string;
  isActive: boolean;
  isAdministrative: boolean;
  units: { id: string; name: string; isActive: boolean }[];
};

export type CatalogScope = { includeAdministrative?: boolean };

export const ACTIVE_REGISTRATION_STATUSES = [
  'draft',
  'approved',
  'blocked',
] as const;

function compareName(a: string, b: string) {
  return a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });
}

export function locationJson(blockName: string, unitName: string) {
  return sql`jsonb_set(
    jsonb_set(coalesce(additional_data, '{}'::jsonb), '{block}', to_jsonb(${blockName}::text), true),
    '{unit}',
    to_jsonb(${unitName}::text),
    true
  )`;
}

@Injectable()
export class ClientBlocksRepository {
  constructor(private readonly database: DatabaseService) {}

  async listCatalog(clientId: string): Promise<CatalogBlock[]> {
    const [blocks, units] = await Promise.all([
      this.database.db
        .select()
        .from(clientBlocks)
        .where(eq(clientBlocks.clientId, clientId)),
      this.database.db
        .select()
        .from(clientUnits)
        .where(eq(clientUnits.clientId, clientId)),
    ]);
    return blocks
      .sort(
        (a, b) =>
          Number(a.isAdministrative) - Number(b.isAdministrative) ||
          compareName(a.name, b.name),
      )
      .map((block) => ({
        id: block.id,
        name: block.name,
        isActive: block.isActive,
        isAdministrative: block.isAdministrative,
        units: units
          .filter((unit) => unit.blockId === block.id)
          .sort((a, b) => compareName(a.name, b.name))
          .map((unit) => ({
            id: unit.id,
            name: unit.name,
            isActive: unit.isActive,
          })),
      }));
  }

  async listActiveCatalog(
    clientId: string,
    { includeAdministrative = true }: CatalogScope = {},
  ): Promise<CatalogBlock[]> {
    const catalog = await this.listCatalog(clientId);
    return catalog
      .filter(
        (block) =>
          block.isActive && (includeAdministrative || !block.isAdministrative),
      )
      .map((block) => ({
        ...block,
        units: block.units.filter((unit) => unit.isActive),
      }));
  }

  async countActiveUnits(
    clientId: string,
    { includeAdministrative = true }: CatalogScope = {},
  ): Promise<number> {
    const [row] = await this.database.db
      .select({ total: count() })
      .from(clientUnits)
      .innerJoin(clientBlocks, eq(clientBlocks.id, clientUnits.blockId))
      .where(
        and(
          eq(clientUnits.clientId, clientId),
          eq(clientUnits.isActive, true),
          eq(clientBlocks.isActive, true),
          includeAdministrative
            ? undefined
            : eq(clientBlocks.isAdministrative, false),
        ),
      );
    return Number(row?.total ?? 0);
  }

  async getBlock(clientId: string, blockId: string) {
    const [row] = await this.database.db
      .select()
      .from(clientBlocks)
      .where(
        and(eq(clientBlocks.id, blockId), eq(clientBlocks.clientId, clientId)),
      )
      .limit(1);
    return row ?? null;
  }

  async findBlockByName(clientId: string, name: string) {
    const [row] = await this.database.db
      .select()
      .from(clientBlocks)
      .where(
        and(
          eq(clientBlocks.clientId, clientId),
          sql`lower(${clientBlocks.name}) = ${name.toLowerCase()}`,
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async insertBlock(clientId: string, name: string) {
    const [row] = await this.database.db
      .insert(clientBlocks)
      .values({ clientId, name })
      .returning();
    return row;
  }

  async updateBlock(
    clientId: string,
    blockId: string,
    patch: { name?: string; isActive?: boolean; isAdministrative?: boolean },
  ) {
    const [row] = await this.database.db
      .update(clientBlocks)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(eq(clientBlocks.id, blockId), eq(clientBlocks.clientId, clientId)),
      )
      .returning();
    return row ?? null;
  }

  async countActiveUnitsInBlock(blockId: string) {
    const [row] = await this.database.db
      .select({ total: count() })
      .from(clientUnits)
      .where(
        and(eq(clientUnits.blockId, blockId), eq(clientUnits.isActive, true)),
      );
    return Number(row?.total ?? 0);
  }

  async getUnit(clientId: string, unitId: string) {
    const [row] = await this.database.db
      .select()
      .from(clientUnits)
      .where(
        and(eq(clientUnits.id, unitId), eq(clientUnits.clientId, clientId)),
      )
      .limit(1);
    return row ?? null;
  }

  async getUnitWithBlock(
    clientId: string,
    unitId: string,
  ): Promise<UnitWithBlock | null> {
    const [row] = await this.database.db
      .select({ unit: clientUnits, block: clientBlocks })
      .from(clientUnits)
      .innerJoin(clientBlocks, eq(clientBlocks.id, clientUnits.blockId))
      .where(
        and(eq(clientUnits.id, unitId), eq(clientUnits.clientId, clientId)),
      )
      .limit(1);
    return row ?? null;
  }

  async getActiveUnitLocation(
    clientId: string,
    unitId: string,
  ): Promise<ActiveUnitLocation | null> {
    const row = await this.getUnitWithBlock(clientId, unitId);
    if (!row || !row.unit.isActive || !row.block.isActive) return null;
    return {
      unitId: row.unit.id,
      blockId: row.block.id,
      blockName: row.block.name,
      unitName: row.unit.name,
      isAdministrative: row.block.isAdministrative,
    };
  }

  async findUnitByName(blockId: string, name: string) {
    const [row] = await this.database.db
      .select()
      .from(clientUnits)
      .where(
        and(
          eq(clientUnits.blockId, blockId),
          sql`lower(${clientUnits.name}) = ${name.toLowerCase()}`,
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async listUnitNames(blockId: string) {
    const rows = await this.database.db
      .select({ name: clientUnits.name })
      .from(clientUnits)
      .where(eq(clientUnits.blockId, blockId));
    return rows.map((row) => row.name);
  }

  async insertUnit(clientId: string, blockId: string, name: string) {
    const [row] = await this.database.db
      .insert(clientUnits)
      .values({ clientId, blockId, name })
      .returning();
    return row;
  }

  async insertUnits(clientId: string, blockId: string, names: string[]) {
    if (names.length === 0) return [];
    return this.database.db
      .insert(clientUnits)
      .values(names.map((name) => ({ clientId, blockId, name })))
      .returning();
  }

  /** Cria blocos e unidades que faltam; blocos inativos com o mesmo nome são pulados. */
  async generateStructure(
    clientId: string,
    blockNames: string[],
    unitNames: string[],
  ) {
    return this.database.db.transaction(async (tx) => {
      const existingBlocks = await tx
        .select()
        .from(clientBlocks)
        .where(eq(clientBlocks.clientId, clientId));
      const byName = new Map(
        existingBlocks.map((block) => [block.name.toLowerCase(), block]),
      );

      const inactiveBlocksSkipped: string[] = [];
      const missingBlockNames: string[] = [];
      const activeBlocks: ClientBlockRow[] = [];
      for (const name of blockNames) {
        const existing = byName.get(name.toLowerCase());
        if (!existing) missingBlockNames.push(name);
        else if (existing.isActive) activeBlocks.push(existing);
        else inactiveBlocksSkipped.push(existing.name);
      }

      const createdBlocks =
        missingBlockNames.length > 0
          ? await tx
              .insert(clientBlocks)
              .values(missingBlockNames.map((name) => ({ clientId, name })))
              .returning()
          : [];
      const targetBlocks = [...activeBlocks, ...createdBlocks];
      if (targetBlocks.length === 0) {
        return {
          blocksCreated: 0,
          unitsCreated: 0,
          unitsSkipped: 0,
          inactiveBlocksSkipped,
        };
      }

      const existingUnits = await tx
        .select({ blockId: clientUnits.blockId, name: clientUnits.name })
        .from(clientUnits)
        .where(
          inArray(
            clientUnits.blockId,
            targetBlocks.map((block) => block.id),
          ),
        );
      const taken = new Set(
        existingUnits.map(
          (unit) => `${unit.blockId}|${unit.name.toLowerCase()}`,
        ),
      );
      const toInsert = targetBlocks.flatMap((block) =>
        unitNames
          .filter((name) => !taken.has(`${block.id}|${name.toLowerCase()}`))
          .map((name) => ({ clientId, blockId: block.id, name })),
      );
      if (toInsert.length > 0) await tx.insert(clientUnits).values(toInsert);

      return {
        blocksCreated: createdBlocks.length,
        unitsCreated: toInsert.length,
        unitsSkipped: targetBlocks.length * unitNames.length - toInsert.length,
        inactiveBlocksSkipped,
      };
    });
  }

  async updateUnit(
    clientId: string,
    unitId: string,
    patch: { name?: string; isActive?: boolean },
  ) {
    const [row] = await this.database.db
      .update(clientUnits)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(eq(clientUnits.id, unitId), eq(clientUnits.clientId, clientId)),
      )
      .returning();
    return row ?? null;
  }

  async countActiveOccupants(unitId: string) {
    const [registrationsRow, membersRow] = await Promise.all([
      this.database.db
        .select({ total: count() })
        .from(registrations)
        .where(
          and(
            eq(registrations.unitId, unitId),
            eq(registrations.isActive, true),
            inArray(registrations.status, [...ACTIVE_REGISTRATION_STATUSES]),
          ),
        ),
      this.database.db
        .select({ total: count() })
        .from(clientMembers)
        .where(
          and(
            eq(clientMembers.unitId, unitId),
            eq(clientMembers.isActive, true),
          ),
        ),
    ]);
    return (
      Number(registrationsRow[0]?.total ?? 0) +
      Number(membersRow[0]?.total ?? 0)
    );
  }

  async syncBlockLabel(blockId: string, blockName: string) {
    const label = sql`jsonb_set(coalesce(additional_data, '{}'::jsonb), '{block}', to_jsonb(${blockName}::text), true)`;
    await this.database.db.execute(sql`
      UPDATE registrations AS r
      SET additional_data = ${label}, updated_at = now()
      FROM client_units AS u
      WHERE r.unit_id = u.id AND u.block_id = ${blockId}
    `);
    await this.database.db.execute(sql`
      UPDATE client_members AS m
      SET additional_data = ${label}, updated_at = now()
      FROM client_units AS u
      WHERE m.unit_id = u.id AND u.block_id = ${blockId}
    `);
  }

  async syncUnitLabel(unitId: string, blockName: string, unitName: string) {
    const label = locationJson(blockName, unitName);
    await this.database.db.execute(sql`
      UPDATE registrations
      SET additional_data = ${label}, updated_at = now()
      WHERE unit_id = ${unitId}
    `);
    await this.database.db.execute(sql`
      UPDATE client_members
      SET additional_data = ${label}, updated_at = now()
      WHERE unit_id = ${unitId}
    `);
  }

  async mergeUnits(input: {
    sourceUnitId: string;
    targetUnitId: string;
    blockName: string;
    unitName: string;
  }) {
    const label = locationJson(input.blockName, input.unitName);
    await this.database.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE registrations
        SET unit_id = ${input.targetUnitId},
            additional_data = ${label},
            updated_at = now()
        WHERE unit_id = ${input.sourceUnitId}
      `);
      await tx.execute(sql`
        UPDATE client_members
        SET unit_id = ${input.targetUnitId},
            additional_data = ${label},
            updated_at = now()
        WHERE unit_id = ${input.sourceUnitId}
      `);
      await tx
        .update(clientUnits)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(clientUnits.id, input.sourceUnitId));
    });
  }
}
