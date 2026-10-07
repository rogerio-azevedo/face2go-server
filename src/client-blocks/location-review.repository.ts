import { Injectable } from '@nestjs/common';
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
  type SQL,
} from 'drizzle-orm';

import { DatabaseService } from '../database/database.service';
import { clientMembers, clientUnits, registrations } from '../database/schema';
import {
  ACTIVE_REGISTRATION_STATUSES,
  locationJson,
} from './client-blocks.repository';
import {
  buildLogicalLinkedPeople,
  registrationsWithoutMembers,
  type LinkedPersonRow,
} from './location-review-people';

export type { LinkedPersonRow } from './location-review-people';

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

  /** Pessoas ativas sem `unit_id`, com o texto de bloco/unidade. */
  async listUnlinkedPeople(clientId: string): Promise<LocationPersonRow[]> {
    const [registrationRows, memberRows, activeMemberRegistrationRows] =
      await Promise.all([
        this.database.db
          .select({
            id: registrations.id,
            name: registrations.name,
            faceId: registrations.faceId,
            unitId: registrations.unitId,
            block: sql<
              string | null
            >`${registrations.additionalData}->>'block'`,
            unit: sql<string | null>`${registrations.additionalData}->>'unit'`,
          })
          .from(registrations)
          .where(
            and(
              eq(registrations.clientId, clientId),
              isNull(registrations.unitId),
              eq(registrations.isActive, true),
              inArray(registrations.status, [...ACTIVE_REGISTRATION_STATUSES]),
            ),
          ),
        this.database.db
          .select({
            id: clientMembers.id,
            registrationId: clientMembers.registrationId,
            name: clientMembers.name,
            faceId: clientMembers.faceId,
            unitId: clientMembers.unitId,
            block: sql<
              string | null
            >`${clientMembers.additionalData}->>'block'`,
            unit: sql<string | null>`${clientMembers.additionalData}->>'unit'`,
          })
          .from(clientMembers)
          .where(
            and(
              eq(clientMembers.clientId, clientId),
              isNull(clientMembers.unitId),
              eq(clientMembers.isActive, true),
            ),
          ),
        this.database.db
          .select({ registrationId: clientMembers.registrationId })
          .from(clientMembers)
          .where(
            and(
              eq(clientMembers.clientId, clientId),
              eq(clientMembers.isActive, true),
              isNotNull(clientMembers.registrationId),
            ),
          ),
      ]);
    const standaloneRegistrations = registrationsWithoutMembers(
      registrationRows,
      activeMemberRegistrationRows.map((row) => row.registrationId),
    );
    return [
      ...standaloneRegistrations.map((row) => ({
        ...row,
        kind: 'registration' as const,
      })),
      ...memberRows.map((row) => ({
        id: row.id,
        name: row.name,
        faceId: row.faceId,
        unitId: row.unitId,
        block: row.block,
        unit: row.unit,
        kind: 'member' as const,
      })),
    ];
  }

  /** Todos com `unit_id`, inclusive inativos (eles também impedem excluir a unidade). */
  async listLinkedPeople(
    clientId: string,
    unitId?: string,
  ): Promise<LinkedPersonRow[]> {
    const [registrationRows, memberRows] = await Promise.all([
      this.database.db
        .select({
          id: registrations.id,
          name: registrations.name,
          faceId: registrations.faceId,
          unitId: registrations.unitId,
          active: sql<boolean>`(${registrations.isActive} AND ${registrations.status} IN (${ACTIVE_STATUSES_SQL}))`,
        })
        .from(registrations)
        .where(
          and(
            eq(registrations.clientId, clientId),
            unitId
              ? eq(registrations.unitId, unitId)
              : isNotNull(registrations.unitId),
          ),
        ),
      this.database.db
        .select({
          id: clientMembers.id,
          registrationId: clientMembers.registrationId,
          name: clientMembers.name,
          faceId: clientMembers.faceId,
          unitId: clientMembers.unitId,
          active: clientMembers.isActive,
        })
        .from(clientMembers)
        .where(
          and(
            eq(clientMembers.clientId, clientId),
            unitId
              ? eq(clientMembers.unitId, unitId)
              : isNotNull(clientMembers.unitId),
          ),
        ),
    ]);
    return buildLogicalLinkedPeople(
      registrationRows.map((row) => ({ ...row, unitId: row.unitId! })),
      memberRows.map((row) => ({ ...row, unitId: row.unitId! })),
    );
  }

  /** Tira a unidade das pessoas (mantém o texto) e desativa a unidade. */
  async unlinkUnit(
    clientId: string,
    unitId: string,
  ): Promise<{ registrations: number; members: number }> {
    return this.database.db.transaction(async (tx) => {
      const regs = await tx
        .update(registrations)
        .set({ unitId: null, updatedAt: new Date() })
        .where(
          and(
            eq(registrations.clientId, clientId),
            eq(registrations.unitId, unitId),
          ),
        )
        .returning({ id: registrations.id });
      const mems = await tx
        .update(clientMembers)
        .set({ unitId: null, updatedAt: new Date() })
        .where(
          and(
            eq(clientMembers.clientId, clientId),
            eq(clientMembers.unitId, unitId),
          ),
        )
        .returning({ id: clientMembers.id });
      await tx
        .update(clientUnits)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(eq(clientUnits.id, unitId), eq(clientUnits.clientId, clientId)),
        );
      return { registrations: regs.length, members: mems.length };
    });
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
