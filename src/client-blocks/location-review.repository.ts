import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, sql, type SQL } from 'drizzle-orm';

import { DatabaseService } from '../database/database.service';
import {
  clientBlocks,
  clientMembers,
  clientUnits,
  clients,
  registrations,
} from '../database/schema';
import {
  ACTIVE_REGISTRATION_STATUSES,
  locationJson,
} from './client-blocks.repository';

export type LocationPersonKind = 'registration' | 'member';

export type LocationPersonRow = {
  kind: LocationPersonKind;
  id: string;
  name: string | null;
  faceId: number | null;
  unitId: string | null;
  block: string | null;
  unit: string | null;
};

export type LocationCounts = {
  clientId: string;
  linked: number;
  textOnly: number;
  noLocation: number;
  groups: number;
};

/** Texto do JSON normalizado: trim, espaços colapsados e minúsculas. */
function normColumn(alias: string, key: 'block' | 'unit') {
  return sql.raw(
    `lower(regexp_replace(btrim(coalesce(${alias}.additional_data->>'${key}', '')), '[[:space:]]+', ' ', 'g'))`,
  );
}

function normParam(value: string): SQL {
  return sql`lower(regexp_replace(btrim(${value}::text), '[[:space:]]+', ' ', 'g'))`;
}

const ACTIVE_STATUSES_SQL = sql.raw(
  ACTIVE_REGISTRATION_STATUSES.map((status) => `'${status}'`).join(', '),
);

@Injectable()
export class LocationReviewRepository {
  constructor(private readonly database: DatabaseService) {}

  listCondominiums(companyId: string) {
    return this.database.db
      .select({
        id: clients.id,
        name: clients.name,
        isActive: clients.isActive,
      })
      .from(clients)
      .where(
        and(eq(clients.companyId, companyId), eq(clients.type, 'condominium')),
      )
      .orderBy(asc(clients.name));
  }

  async countActiveUnitsByClient(clientIds: string[]) {
    if (clientIds.length === 0) return new Map<string, number>();
    const rows = await this.database.db
      .select({ clientId: clientUnits.clientId, total: count() })
      .from(clientUnits)
      .innerJoin(clientBlocks, eq(clientBlocks.id, clientUnits.blockId))
      .where(
        and(
          inArray(clientUnits.clientId, clientIds),
          eq(clientUnits.isActive, true),
          eq(clientBlocks.isActive, true),
        ),
      )
      .groupBy(clientUnits.clientId);
    return new Map(rows.map((row) => [row.clientId, Number(row.total)]));
  }

  async countLocationsByCompany(companyId: string): Promise<LocationCounts[]> {
    const result = await this.database.db.execute(sql`
      WITH scope AS (
        SELECT id FROM clients
        WHERE company_id = ${companyId} AND type = 'condominium'
      ), people AS (
        SELECT r.client_id, r.unit_id,
               ${normColumn('r', 'block')} AS bk,
               ${normColumn('r', 'unit')} AS uk
        FROM registrations r
        WHERE r.client_id IN (SELECT id FROM scope)
          AND r.is_active AND r.status IN (${ACTIVE_STATUSES_SQL})
        UNION ALL
        SELECT m.client_id, m.unit_id,
               ${normColumn('m', 'block')},
               ${normColumn('m', 'unit')}
        FROM client_members m
        WHERE m.client_id IN (SELECT id FROM scope) AND m.is_active
      )
      SELECT client_id AS "clientId",
        count(*) FILTER (WHERE unit_id IS NOT NULL)::int AS "linked",
        count(*) FILTER (WHERE unit_id IS NULL AND (bk <> '' OR uk <> ''))::int AS "textOnly",
        count(*) FILTER (WHERE unit_id IS NULL AND bk = '' AND uk = '')::int AS "noLocation",
        count(DISTINCT bk || '|' || uk) FILTER (WHERE unit_id IS NULL AND (bk <> '' OR uk <> ''))::int AS "groups"
      FROM people
      GROUP BY client_id
    `);
    return (result as unknown as { rows?: LocationCounts[] }).rows ?? [];
  }

  async listPeople(clientId: string): Promise<LocationPersonRow[]> {
    const [registrationRows, memberRows] = await Promise.all([
      this.database.db
        .select({
          id: registrations.id,
          name: registrations.name,
          faceId: registrations.faceId,
          unitId: registrations.unitId,
          block: sql<string | null>`${registrations.additionalData}->>'block'`,
          unit: sql<string | null>`${registrations.additionalData}->>'unit'`,
        })
        .from(registrations)
        .where(
          and(
            eq(registrations.clientId, clientId),
            eq(registrations.isActive, true),
            inArray(registrations.status, [...ACTIVE_REGISTRATION_STATUSES]),
          ),
        ),
      this.database.db
        .select({
          id: clientMembers.id,
          name: clientMembers.name,
          faceId: clientMembers.faceId,
          unitId: clientMembers.unitId,
          block: sql<string | null>`${clientMembers.additionalData}->>'block'`,
          unit: sql<string | null>`${clientMembers.additionalData}->>'unit'`,
        })
        .from(clientMembers)
        .where(
          and(
            eq(clientMembers.clientId, clientId),
            eq(clientMembers.isActive, true),
          ),
        ),
    ]);
    return [
      ...registrationRows.map((row) => ({
        ...row,
        kind: 'registration' as const,
      })),
      ...memberRows.map((row) => ({ ...row, kind: 'member' as const })),
    ];
  }

  /**
   * Vincula quem tem o par de texto e ainda não tem `unit_id`. Cadastro e membro
   * ligados pelo `registration_id` recebem a mesma unidade.
   */
  async bindGroup(input: {
    clientId: string;
    blockText: string;
    unitText: string;
    unitId: string;
    blockName: string;
    unitName: string;
  }): Promise<{ registrations: number; members: number }> {
    const label = locationJson(input.blockName, input.unitName);
    const blockKey = normParam(input.blockText);
    const unitKey = normParam(input.unitText);
    const result = await this.database.db.execute(sql`
      WITH reg AS (
        UPDATE registrations AS r
        SET unit_id = ${input.unitId}, additional_data = ${label}, updated_at = now()
        WHERE r.client_id = ${input.clientId}
          AND r.unit_id IS NULL
          AND r.is_active AND r.status IN (${ACTIVE_STATUSES_SQL})
          AND ${normColumn('r', 'block')} = ${blockKey}
          AND ${normColumn('r', 'unit')} = ${unitKey}
        RETURNING r.id
      ), mem AS (
        UPDATE client_members AS m
        SET unit_id = ${input.unitId}, additional_data = ${label}, updated_at = now()
        WHERE m.client_id = ${input.clientId}
          AND m.unit_id IS NULL
          AND m.is_active
          AND ${normColumn('m', 'block')} = ${blockKey}
          AND ${normColumn('m', 'unit')} = ${unitKey}
        RETURNING m.id, m.registration_id
      ), mem_linked AS (
        UPDATE client_members AS m
        SET unit_id = ${input.unitId}, additional_data = ${label}, updated_at = now()
        WHERE m.client_id = ${input.clientId}
          AND m.unit_id IS NULL
          AND m.registration_id IN (SELECT id FROM reg)
          AND m.id NOT IN (SELECT id FROM mem)
        RETURNING m.id
      ), reg_linked AS (
        UPDATE registrations AS r
        SET unit_id = ${input.unitId}, additional_data = ${label}, updated_at = now()
        WHERE r.client_id = ${input.clientId}
          AND r.unit_id IS NULL
          AND r.id IN (SELECT registration_id FROM mem WHERE registration_id IS NOT NULL)
          AND r.id NOT IN (SELECT id FROM reg)
        RETURNING r.id
      )
      SELECT
        ((SELECT count(*) FROM reg) + (SELECT count(*) FROM reg_linked))::int AS "registrations",
        ((SELECT count(*) FROM mem) + (SELECT count(*) FROM mem_linked))::int AS "members"
    `);
    const row = (
      result as unknown as {
        rows?: { registrations: number; members: number }[];
      }
    ).rows?.[0];
    return {
      registrations: Number(row?.registrations ?? 0),
      members: Number(row?.members ?? 0),
    };
  }
}
