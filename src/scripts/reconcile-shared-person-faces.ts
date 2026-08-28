/**
 * Backfill legado: alinha face entre vínculos irmãos (mesmo userId + escola)
 * e copia face de outra escola quando não há foto local.
 *
 * Uso:
 *   pnpm db:reconcile-shared-faces              # dry-run (padrão)
 *   pnpm db:reconcile-shared-faces --apply        # aplica (compila automaticamente)
 *   pnpm db:reconcile-shared-faces --apply --user-id=<uuid>
 *   pnpm db:reconcile-shared-faces --no-cross-client
 */
import 'reflect-metadata';
import 'dotenv/config';

import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { and, eq, isNotNull } from 'drizzle-orm';
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
import { PeopleModule } from '../people/people.module';
import { PersonProfileService } from '../people/person-profile.service';
import { StorageModule } from '../storage/storage.module';

type BondKind = 'responsible' | 'member';

type PersonBond = {
  kind: BondKind;
  id: string;
  userId: string;
  clientId: string;
  clientName: string;
  name: string;
  faceId: number | null;
  photoKey: string | null;
};

type ClientGroup = {
  userId: string;
  clientId: string;
  clientName: string;
  bonds: PersonBond[];
};

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const crossClient = !args.includes('--no-cross-client');
const userIdFilter = args
  .find((a) => a.startsWith('--user-id='))
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
    `node -r reflect-metadata dist/scripts/reconcile-shared-person-faces.js ${forwarded}`,
    { stdio: 'inherit', cwd: process.cwd(), env: process.env },
  );
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DatabaseModule,
    StorageModule,
    FaceSyncModule,
    PeopleModule,
  ],
})
class ReconcileSharedFacesScriptModule {}

function hasCompleteFace(bond: PersonBond): boolean {
  return bond.faceId != null && bond.photoKey != null;
}

function isFaceGap(bond: PersonBond): boolean {
  return !hasCompleteFace(bond);
}

function bondRef(bond: PersonBond): {
  type: BondKind;
  id: string;
  name: string;
} {
  return { type: bond.kind, id: bond.id, name: bond.name };
}

function pickCrossClientTarget(bonds: PersonBond[]): PersonBond {
  const responsible = bonds.find((b) => b.kind === 'responsible');
  return responsible ?? bonds[0];
}

function findSharedFaceInGroup(group: ClientGroup): PersonBond | null {
  return group.bonds.find(hasCompleteFace) ?? null;
}

function indexCompleteFacesByUser(
  bonds: PersonBond[],
): Map<string, PersonBond[]> {
  const map = new Map<string, PersonBond[]>();
  for (const bond of bonds) {
    if (!hasCompleteFace(bond)) continue;
    const list = map.get(bond.userId) ?? [];
    list.push(bond);
    map.set(bond.userId, list);
  }
  return map;
}

function findFaceInOtherClient(
  facesByUser: Map<string, PersonBond[]>,
  userId: string,
  clientId: string,
): PersonBond | null {
  const list = facesByUser.get(userId) ?? [];
  return list.find((b) => b.clientId !== clientId) ?? null;
}

async function loadPersonBonds(db: AppDb): Promise<PersonBond[]> {
  const [responsibleRows, memberRows, clientRows] = await Promise.all([
    db
      .select({
        id: schema.responsibles.id,
        userId: schema.responsibles.userId,
        clientId: schema.responsibles.clientId,
        name: schema.responsibles.name,
        faceId: schema.responsibles.faceId,
        photoKey: schema.responsibles.photoKey,
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
        id: schema.clientMembers.id,
        userId: schema.clientMembers.userId,
        clientId: schema.clientMembers.clientId,
        name: schema.clientMembers.name,
        faceId: schema.clientMembers.faceId,
        photoKey: schema.clientMembers.photoKey,
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

  const bonds: PersonBond[] = [
    ...responsibleRows.map((row) => ({
      kind: 'responsible' as const,
      id: row.id,
      userId: row.userId!,
      clientId: row.clientId,
      clientName: clientNameById.get(row.clientId) ?? row.clientId,
      name: row.name,
      faceId: row.faceId,
      photoKey: row.photoKey,
    })),
    ...memberRows.map((row) => ({
      kind: 'member' as const,
      id: row.id,
      userId: row.userId!,
      clientId: row.clientId,
      clientName: clientNameById.get(row.clientId) ?? row.clientId,
      name: row.name,
      faceId: row.faceId,
      photoKey: row.photoKey,
    })),
  ];

  return bonds.filter((b) => b.userId);
}

function groupByUserAndClient(bonds: PersonBond[]): ClientGroup[] {
  const map = new Map<string, ClientGroup>();

  for (const bond of bonds) {
    const key = `${bond.userId}:${bond.clientId}`;
    const existing = map.get(key);
    if (existing) {
      existing.bonds.push(bond);
      continue;
    }
    map.set(key, {
      userId: bond.userId,
      clientId: bond.clientId,
      clientName: bond.clientName,
      bonds: [bond],
    });
  }

  return [...map.values()].filter((g) => g.bonds.length > 0);
}

async function main() {
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

  const bonds = await loadPersonBonds(db);
  const groups = groupByUserAndClient(bonds);
  const facesByUser = indexCompleteFacesByUser(bonds);

  console.log(
    `${bonds.length} vínculo(s) com userId, ${groups.length} grupo(s) user+escola.\n`,
  );
  console.log(
    apply
      ? 'Modo APPLY — alterações serão persistidas.\n'
      : 'Modo DRY-RUN — nada será alterado. Use --apply para executar.\n',
  );
  if (userIdFilter) {
    console.log(`Filtro userId: ${userIdFilter}\n`);
  }

  let sameClientPlanned = 0;
  let crossClientPlanned = 0;
  let sameClientApplied = 0;
  let crossClientApplied = 0;
  let conflicts = 0;

  let nest: Awaited<
    ReturnType<typeof NestFactory.createApplicationContext>
  > | null = null;
  if (apply) {
    nest = await NestFactory.createApplicationContext(
      ReconcileSharedFacesScriptModule,
      { logger: ['error', 'warn'] },
    );
  }
  const personProfile = nest?.get(PersonProfileService);

  try {
    for (const group of groups) {
      const complete = group.bonds.filter(hasCompleteFace);
      const gaps = group.bonds.filter(isFaceGap);

      if (gaps.length === 0) continue;

      const distinctFaceIds = [
        ...new Set(complete.map((b) => b.faceId).filter((id) => id != null)),
      ];

      if (distinctFaceIds.length > 1) {
        conflicts += 1;
        console.log(
          `⚠️  CONFLITO userId=${group.userId} escola=${group.clientName} (${group.clientId})`,
        );
        console.log(
          `    Vários faceIds na mesma escola: ${distinctFaceIds.join(', ')} — correção manual.`,
        );
        for (const bond of group.bonds) {
          console.log(
            `    - ${bond.kind} ${bond.id} faceId=${bond.faceId ?? 'null'} photoKey=${bond.photoKey ?? 'null'}`,
          );
        }
        console.log('');
        continue;
      }

      const sharedBond = findSharedFaceInGroup(group);

      if (sharedBond) {
        for (const gap of gaps) {
          sameClientPlanned += 1;
          console.log(
            `${apply ? '→' : '○'} Mesma escola: copiar face para ${gap.kind} ${gap.name} (${gap.id}) ` +
              `[${group.clientName}] faceId=${sharedBond.faceId}`,
          );

          if (apply && personProfile) {
            const ok = await personProfile.applySharedFaceFromSameClient(
              group.userId,
              group.clientId,
              bondRef(gap),
            );
            if (ok) sameClientApplied += 1;
            else
              console.warn(
                `    Falha ao aplicar face em ${gap.kind} ${gap.id}`,
              );
          }
        }
        continue;
      }

      if (!crossClient) continue;

      const sourceBond = findFaceInOtherClient(
        facesByUser,
        group.userId,
        group.clientId,
      );
      if (!sourceBond) continue;

      const target = pickCrossClientTarget(gaps);
      crossClientPlanned += 1;
      console.log(
        `${apply ? '→' : '○'} Outra escola: copiar face de ${sourceBond.clientName} (${sourceBond.clientId}) ` +
          `para ${target.kind} ${target.name} (${target.id}) [${group.clientName}] ` +
          `(propaga para ${gaps.length} vínculo(s) sem foto nesta escola)`,
      );

      if (apply && personProfile) {
        const ok = await personProfile.copyFaceFromOtherClientToBond(
          group.userId,
          group.clientId,
          bondRef(target),
          'reconcile-shared-faces-script',
        );
        if (ok) crossClientApplied += 1;
        else
          console.warn(
            `    Falha ao copiar face cross-client para ${target.kind} ${target.id}`,
          );
      }
    }

    console.log('\n--- Resumo ---');
    console.log(
      `Mesma escola: ${sameClientPlanned} correção(ões) planejada(s)` +
        (apply ? `, ${sameClientApplied} aplicada(s)` : ''),
    );
    if (crossClient) {
      console.log(
        `Outra escola: ${crossClientPlanned} correção(ões) planejada(s)` +
          (apply ? `, ${crossClientApplied} aplicada(s)` : ''),
      );
    } else {
      console.log('Outra escola: ignorado (--no-cross-client)');
    }
    console.log(`Conflitos (manual): ${conflicts}`);

    if (!apply && (sameClientPlanned > 0 || crossClientPlanned > 0)) {
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
