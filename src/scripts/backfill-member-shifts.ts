/**
 * Backfill: vincula horários (shifts) aos membros de uma escola.
 *
 * Regra:
 *   - role slug `professor` → horário "Professores"
 *   - demais → horário "Funcionários"
 *
 * Uso:
 *   pnpm db:backfill-member-shifts --client-id=<uuid>              # dry-run (padrão)
 *   pnpm db:backfill-member-shifts --client-id=<uuid> --apply      # aplica + re-sync faces
 */
import 'reflect-metadata';
import 'dotenv/config';

import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

import { validateEnv } from '../config/env.validation';
import {
  createPostgresClient,
  endPostgresPool,
} from '../database/postgres-connection';
import type { AppDb } from '../database/database.types';
import * as schema from '../database/schema';
import { DatabaseModule } from '../database/database.module';
import { FaceSyncModule } from '../face-sync/face-sync.module';
import { AccessTimeZoneService } from '../face-sync/access-time-zone.service';
import { FaceSyncService } from '../face-sync/face-sync.service';
import { StorageModule } from '../storage/storage.module';
import { R2StorageService } from '../storage/r2-storage.service';
import * as membersQueries from '../database/queries/members.queries';
import * as shiftsQueries from '../database/queries/shifts.queries';

const PROFESSORES_SHIFT_NAME = 'Professores';
const FUNCIONARIOS_SHIFT_NAME = 'Funcionários';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const clientIdArg = args
  .find((a) => a.startsWith('--client-id='))
  ?.split('=')[1];

function runningFromDist(): boolean {
  return __dirname.includes(`${join('dist', 'scripts')}`);
}

function reexecFromDistBuild(): void {
  console.log(
    'Modo --apply: compilando NestJS (tsx não preserva metadata de injeção)...\n',
  );
  execSync('pnpm build', { stdio: 'inherit', cwd: process.cwd() });
  const forwarded = process.argv
    .slice(2)
    .map((arg) => JSON.stringify(arg))
    .join(' ');
  execSync(
    `node -r reflect-metadata dist/scripts/backfill-member-shifts.js ${forwarded}`,
    { stdio: 'inherit', cwd: process.cwd(), env: process.env },
  );
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DatabaseModule,
    StorageModule,
    FaceSyncModule,
  ],
})
class BackfillMemberShiftsScriptModule {}

function normalizeShiftName(name: string): string {
  return name.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

function findShiftByName(
  shifts: Awaited<ReturnType<typeof shiftsQueries.listShiftsByClient>>,
  expectedName: string,
) {
  const target = normalizeShiftName(expectedName);
  return (
    shifts.find((s) => normalizeShiftName(s.name) === target) ??
    shifts.find((s) => normalizeShiftName(s.name).includes(target)) ??
    null
  );
}

async function syncMemberFace(
  db: AppDb,
  faceSync: FaceSyncService,
  accessTimeZone: AccessTimeZoneService,
  r2: R2StorageService,
  clientId: string,
  member: Awaited<
    ReturnType<typeof membersQueries.listMembersByClientWithRole>
  >[number],
): Promise<'synced' | 'skipped' | 'failed'> {
  if (!member.photoKey || member.faceId == null) return 'skipped';

  let buffer: Buffer;
  try {
    const got = await r2.getObjectBytes(member.photoKey);
    buffer = got.buffer;
  } catch {
    return 'failed';
  }
  if (buffer.length < 256) return 'failed';

  await membersQueries.updateMemberFace(db, member.id, clientId, {
    deviceSyncStatus: 'pending_sync',
    deviceSyncedAt: null,
    deviceSyncError: null,
  });

  const sync = await faceSync.syncPersonOnReaders({
    clientId,
    faceId: member.faceId,
    name: member.name,
    imageBuffer: buffer,
    timeSectionIds: await accessTimeZone.resolveMemberTimeSections(
      clientId,
      member.id,
    ),
    logContext: `backfill-member-shifts=${member.id}`,
  });

  await membersQueries.updateMemberFace(db, member.id, clientId, {
    deviceSyncStatus: sync.deviceSyncStatus,
    deviceSyncedAt: sync.deviceSyncStatus === 'synced' ? new Date() : null,
    deviceSyncError: sync.deviceSyncError,
  });

  return sync.deviceSyncStatus === 'synced' ? 'synced' : 'failed';
}

async function main() {
  if (!clientIdArg) {
    console.error('Informe --client-id=<uuid>.');
    process.exit(1);
  }

  if (apply && !runningFromDist()) {
    reexecFromDistBuild();
    return;
  }

  const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!databaseUrl) {
    console.error('Defina DATABASE_URL no .env.');
    process.exit(1);
  }

  const sql = createPostgresClient(databaseUrl);
  const db = drizzle(sql, { schema }) as AppDb;

  const [client] = await db
    .select({
      id: schema.clients.id,
      name: schema.clients.name,
      type: schema.clients.type,
    })
    .from(schema.clients)
    .where(eq(schema.clients.id, clientIdArg))
    .limit(1);

  if (!client) {
    console.error(`Cliente não encontrado: ${clientIdArg}`);
    process.exit(1);
  }

  const shifts = await shiftsQueries.listShiftsByClient(db, clientIdArg);
  const professoresShift = findShiftByName(shifts, PROFESSORES_SHIFT_NAME);
  const funcionariosShift = findShiftByName(shifts, FUNCIONARIOS_SHIFT_NAME);

  if (!professoresShift || !funcionariosShift) {
    console.error(
      `Horários "${PROFESSORES_SHIFT_NAME}" e/ou "${FUNCIONARIOS_SHIFT_NAME}" não encontrados.`,
    );
    console.error(
      `Horários disponíveis: ${shifts.map((s) => s.name).join(', ') || '(nenhum)'}`,
    );
    process.exit(1);
  }

  const members = await membersQueries.listMembersByClientWithRole(
    db,
    clientIdArg,
  );

  console.log(
    `Cliente: ${client.name} (${client.id})\n` +
      `Horário professores: ${professoresShift.name} (${professoresShift.id})\n` +
      `Horário funcionários: ${funcionariosShift.name} (${funcionariosShift.id})\n` +
      `${members.length} membro(s) encontrado(s).\n`,
  );
  console.log(
    apply
      ? 'Modo APPLY — alterações serão persistidas.\n'
      : 'Modo DRY-RUN — nada será alterado. Use --apply para executar.\n',
  );

  let planned = 0;
  let updated = 0;
  let synced = 0;
  let syncSkipped = 0;
  let syncFailed = 0;

  let nest: Awaited<
    ReturnType<typeof NestFactory.createApplicationContext>
  > | null = null;
  if (apply) {
    nest = await NestFactory.createApplicationContext(
      BackfillMemberShiftsScriptModule,
      { logger: ['error', 'warn'] },
    );
  }
  const faceSync = nest?.get(FaceSyncService);
  const accessTimeZone = nest?.get(AccessTimeZoneService);
  const r2 = nest?.get(R2StorageService);

  try {
    for (const member of members) {
      const targetShiftId =
        member.roleSlug === 'professor'
          ? professoresShift.id
          : funcionariosShift.id;

      if (member.shiftId === targetShiftId) {
        continue;
      }

      planned += 1;
      const shiftLabel =
        member.roleSlug === 'professor'
          ? PROFESSORES_SHIFT_NAME
          : FUNCIONARIOS_SHIFT_NAME;

      console.log(
        `${apply ? '→' : '○'} ${member.name} (${member.roleName}) → ${shiftLabel}`,
      );

      if (!apply) continue;

      await membersQueries.updateMember(db, member.id, clientIdArg, {
        shiftId: targetShiftId,
      });
      updated += 1;

      if (faceSync && accessTimeZone && r2) {
        const memberAfter = {
          ...member,
          shiftId: targetShiftId,
        };
        const result = await syncMemberFace(
          db,
          faceSync,
          accessTimeZone,
          r2,
          clientIdArg,
          memberAfter,
        );
        if (result === 'synced') synced += 1;
        else if (result === 'skipped') syncSkipped += 1;
        else syncFailed += 1;
      }
    }

    console.log('\n--- Resumo ---');
    console.log(`Vínculos planejados: ${planned}`);
    if (apply) {
      console.log(`Vínculos aplicados: ${updated}`);
      console.log(
        `Faces re-sincronizadas: ${synced} (sem foto: ${syncSkipped}, falha: ${syncFailed})`,
      );
    } else if (planned > 0) {
      console.log('\nExecute com --apply para persistir.');
    }
  } finally {
    if (nest) await nest.close();
    await endPostgresPool(sql);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
