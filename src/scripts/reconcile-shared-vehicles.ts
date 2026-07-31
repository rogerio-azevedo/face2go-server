/**
 * Backfill legado: copia veículos de outras escolas para vínculos locais
 * da mesma pessoa (userId), quando a placa ainda não existe na escola.
 *
 * Uso:
 *   pnpm db:reconcile-shared-vehicles              # dry-run
 *   pnpm db:reconcile-shared-vehicles --apply
 *   pnpm db:reconcile-shared-vehicles --apply --user-id=<uuid>
 */
import 'dotenv/config';

import { and, eq, isNotNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';

import { createPostgresClient } from '../database/postgres-connection';
import type { AppDb } from '../database/database.types';
import * as peopleQueries from '../database/queries/people.queries';
import * as vehicleQueries from '../database/queries/vehicles.queries';
import * as schema from '../database/schema';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const userIdFilter = args.find((a) => a.startsWith('--user-id='))?.split('=')[1];

function normalizePlate(plate: string): string {
  return plate.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

type UserClientGroup = {
  userId: string;
  clientId: string;
  clientName: string;
};

async function loadUserClientGroups(db: AppDb): Promise<UserClientGroup[]> {
  const [responsibleRows, memberRows, clientRows] = await Promise.all([
    db
      .select({
        userId: schema.responsibles.userId,
        clientId: schema.responsibles.clientId,
      })
      .from(schema.responsibles)
      .where(
        and(
          eq(schema.responsibles.isActive, true),
          isNotNull(schema.responsibles.userId),
          userIdFilter
            ? eq(schema.responsibles.userId, userIdFilter)
            : undefined,
        ),
      ),
    db
      .select({
        userId: schema.clientMembers.userId,
        clientId: schema.clientMembers.clientId,
      })
      .from(schema.clientMembers)
      .where(
        and(
          eq(schema.clientMembers.isActive, true),
          isNotNull(schema.clientMembers.userId),
          userIdFilter
            ? eq(schema.clientMembers.userId, userIdFilter)
            : undefined,
        ),
      ),
    db
      .select({ id: schema.clients.id, name: schema.clients.name })
      .from(schema.clients),
  ]);

  const clientNameById = new Map(clientRows.map((c) => [c.id, c.name]));
  const map = new Map<string, UserClientGroup>();

  for (const row of [...responsibleRows, ...memberRows]) {
    if (!row.userId) continue;
    const key = `${row.userId}:${row.clientId}`;
    if (map.has(key)) continue;
    map.set(key, {
      userId: row.userId,
      clientId: row.clientId,
      clientName: clientNameById.get(row.clientId) ?? row.clientId,
    });
  }

  return [...map.values()];
}

async function reconcileGroup(
  db: AppDb,
  group: UserClientGroup,
): Promise<{ planned: number; applied: number }> {
  const owners = await peopleQueries.listVehicleOwnerIdsByUserIdAndClient(
    db,
    group.userId,
    group.clientId,
  );
  const targetResponsibleId = owners.responsibleIds[0];
  const targetMemberId = owners.memberIds[0];
  if (!targetResponsibleId && !targetMemberId) {
    return { planned: 0, applied: 0 };
  }

  const sourceVehicles = await vehicleQueries.vehicleListByUserIdExcludingClient(
    db,
    group.userId,
    group.clientId,
  );
  if (sourceVehicles.length === 0) {
    return { planned: 0, applied: 0 };
  }

  const localVehicles = await vehicleQueries.vehicleListForOwnerBonds(
    db,
    group.clientId,
    owners.responsibleIds,
    owners.memberIds,
  );
  const localPlates = new Set(
    localVehicles.map((v) => normalizePlate(v.plate)),
  );

  let planned = 0;
  let applied = 0;

  for (const source of sourceVehicles) {
    const plateNorm = normalizePlate(source.plate);
    if (localPlates.has(plateNorm)) continue;

    const existing = await vehicleQueries.vehicleFindByPlateInClient(
      db,
      group.clientId,
      source.plate,
    );
    if (existing) {
      console.log(
        `⚠️  Placa ${source.plate} já existe em ${group.clientName} (outro condutor) — skip`,
      );
      continue;
    }

    planned += 1;
    const targetKind = targetResponsibleId ? 'responsible' : 'member';
    const targetId = targetResponsibleId ?? targetMemberId!;
    console.log(
      `${apply ? '→' : '○'} Copiar ${source.plate} (${source.brand} ${source.model}) ` +
        `para ${targetKind} em ${group.clientName} [${group.clientId}]`,
    );

    if (!apply) continue;

    try {
      await vehicleQueries.vehicleInsert(db, {
        clientId: group.clientId,
        responsibleId: targetResponsibleId ?? null,
        memberId: targetResponsibleId ? null : targetMemberId,
        plate: source.plate.trim().toUpperCase(),
        brand: source.brand,
        model: source.model,
        color: source.color,
      });
      localPlates.add(plateNorm);
      applied += 1;
    } catch (e) {
      console.warn(
        `    Falha ao inserir ${source.plate}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return { planned, applied };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!databaseUrl) {
    console.error('Defina DATABASE_URL no .env.');
    process.exit(1);
  }

  const sql = createPostgresClient(databaseUrl);
  const db = drizzle(sql, { schema }) as AppDb;

  const groups = await loadUserClientGroups(db);

  console.log(
    apply
      ? 'Modo APPLY — veículos serão cadastrados na escola local.\n'
      : 'Modo DRY-RUN — nada será alterado. Use --apply para executar.\n',
  );
  if (userIdFilter) {
    console.log(`Filtro userId: ${userIdFilter}\n`);
  }
  console.log(`${groups.length} grupo(s) user+escola.\n`);

  let totalPlanned = 0;
  let totalApplied = 0;

  for (const group of groups) {
    const { planned, applied } = await reconcileGroup(db, group);
    totalPlanned += planned;
    totalApplied += applied;
  }

  console.log('\n--- Resumo ---');
  console.log(
    `${totalPlanned} cópia(s) planejada(s)` +
      (apply ? `, ${totalApplied} aplicada(s)` : ''),
  );
  if (!apply && totalPlanned > 0) {
    console.log('\nExecute com --apply para persistir.');
    console.log(
      'Após o deploy do server, abra Veículos no app para sincronizar LPR.',
    );
  }

  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
