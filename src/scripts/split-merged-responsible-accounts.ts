/**
 * Separa contas de login fundidas entre responsáveis com CPFs diferentes
 * (legado da integração TOTVS IENH quando pai e mãe compartilham e-mail).
 *
 * Uso:
 *   pnpm db:split-merged-responsibles              # dry-run (padrão)
 *   pnpm db:split-merged-responsibles --apply
 */
import 'dotenv/config';

import * as bcrypt from 'bcryptjs';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

import {
  createPostgresClient,
  endPostgresPool,
} from '../database/postgres-connection';
import type { AppDb } from '../database/database.types';
import * as schema from '../database/schema';

const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const apply = process.argv.includes('--apply');

function digits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

function nologinEmail(): string {
  return `nologin-${crypto.randomUUID()}@sem-acesso.face2go`;
}

type ResponsibleRow = {
  id: string;
  clientId: string;
  userId: string | null;
  name: string;
  document: string | null;
  photoKey: string | null;
  faceId: number | null;
};

async function loadResponsiblesByUser(
  db: AppDb,
  userId: string,
): Promise<ResponsibleRow[]> {
  return db
    .select({
      id: schema.responsibles.id,
      clientId: schema.responsibles.clientId,
      userId: schema.responsibles.userId,
      name: schema.responsibles.name,
      document: schema.responsibles.document,
      photoKey: schema.responsibles.photoKey,
      faceId: schema.responsibles.faceId,
    })
    .from(schema.responsibles)
    .where(eq(schema.responsibles.userId, userId));
}

async function faceIdStillUsed(
  db: AppDb,
  clientId: string,
  faceId: number,
): Promise<boolean> {
  const [student, responsible, member] = await Promise.all([
    db
      .select({ id: schema.students.id })
      .from(schema.students)
      .where(
        and(
          eq(schema.students.clientId, clientId),
          eq(schema.students.faceId, faceId),
        ),
      )
      .limit(1),
    db
      .select({ id: schema.responsibles.id })
      .from(schema.responsibles)
      .where(
        and(
          eq(schema.responsibles.clientId, clientId),
          eq(schema.responsibles.faceId, faceId),
        ),
      )
      .limit(1),
    db
      .select({ id: schema.clientMembers.id })
      .from(schema.clientMembers)
      .where(
        and(
          eq(schema.clientMembers.clientId, clientId),
          eq(schema.clientMembers.faceId, faceId),
        ),
      )
      .limit(1),
  ]);
  return Boolean(student[0] || responsible[0] || member[0]);
}

async function reassignResponsibleFks(
  db: AppDb,
  fromId: string,
  toId: string,
  clientId: string,
) {
  const links = await db
    .select()
    .from(schema.responsibleStudents)
    .where(eq(schema.responsibleStudents.responsibleId, fromId));
  for (const link of links) {
    const [already] = await db
      .select({ id: schema.responsibleStudents.id })
      .from(schema.responsibleStudents)
      .where(
        and(
          eq(schema.responsibleStudents.responsibleId, toId),
          eq(schema.responsibleStudents.studentId, link.studentId),
        ),
      )
      .limit(1);
    if (already) {
      await db
        .delete(schema.responsibleStudents)
        .where(eq(schema.responsibleStudents.id, link.id));
    } else {
      await db
        .update(schema.responsibleStudents)
        .set({ responsibleId: toId })
        .where(eq(schema.responsibleStudents.id, link.id));
    }
  }

  const fromVehicles = await db
    .select()
    .from(schema.vehicles)
    .where(eq(schema.vehicles.responsibleId, fromId));
  for (const vehicle of fromVehicles) {
    const [plateTaken] = await db
      .select({ id: schema.vehicles.id })
      .from(schema.vehicles)
      .where(
        and(
          eq(schema.vehicles.clientId, clientId),
          eq(schema.vehicles.plate, vehicle.plate),
          eq(schema.vehicles.responsibleId, toId),
        ),
      )
      .limit(1);
    if (plateTaken) {
      await db
        .delete(schema.vehicles)
        .where(eq(schema.vehicles.id, vehicle.id));
    } else {
      await db
        .update(schema.vehicles)
        .set({ responsibleId: toId, updatedAt: new Date() })
        .where(eq(schema.vehicles.id, vehicle.id));
    }
  }

  await db
    .update(schema.temporaryPickupAuthorizations)
    .set({ requestedByResponsibleId: toId })
    .where(
      eq(schema.temporaryPickupAuthorizations.requestedByResponsibleId, fromId),
    );
  await db
    .update(schema.temporaryPickupAuthorizations)
    .set({ linkedResponsibleId: toId })
    .where(
      eq(schema.temporaryPickupAuthorizations.linkedResponsibleId, fromId),
    );
  await db
    .update(schema.responsibleInvitations)
    .set({ inviterResponsibleId: toId, updatedAt: new Date() })
    .where(eq(schema.responsibleInvitations.inviterResponsibleId, fromId));
  await db
    .update(schema.responsibleInvitations)
    .set({ createdResponsibleId: toId, updatedAt: new Date() })
    .where(eq(schema.responsibleInvitations.createdResponsibleId, fromId));
}

async function mergeDuplicateRows(
  db: AppDb,
  rows: ResponsibleRow[],
  dryRun: boolean,
): Promise<number> {
  const groups = new Map<string, ResponsibleRow[]>();
  for (const row of rows) {
    const doc = digits(row.document);
    if (doc.length !== 11) continue;
    const key = `${row.clientId}:${doc}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  let merged = 0;
  for (const [, group] of groups) {
    if (group.length < 2) continue;
    const ranked = [...group].sort((a, b) => {
      const aPhoto = a.photoKey ? 1 : 0;
      const bPhoto = b.photoKey ? 1 : 0;
      if (bPhoto !== aPhoto) return bPhoto - aPhoto;
      const aClean = a.document && a.document === digits(a.document) ? 1 : 0;
      const bClean = b.document && b.document === digits(b.document) ? 1 : 0;
      return bClean - aClean;
    });
    const winner = ranked[0];
    const losers = ranked.slice(1);
    console.log(
      `  duplicata ${winner.clientId} ${winner.name} [${digits(winner.document)}]: ` +
        `manter ${winner.id}, remover ${losers.map((l) => l.id).join(', ')}`,
    );
    if (dryRun) {
      merged += losers.length;
      continue;
    }
    for (const loser of losers) {
      await reassignResponsibleFks(db, loser.id, winner.id, winner.clientId);
      await db
        .delete(schema.responsibles)
        .where(eq(schema.responsibles.id, loser.id));
      merged += 1;
    }
  }
  return merged;
}

async function clearInheritedFace(
  db: AppDb,
  row: ResponsibleRow,
  ownerFaceKeys: Set<string>,
  ownerFaceIds: Set<number>,
  dryRun: boolean,
): Promise<boolean> {
  const inheritedPhoto = Boolean(
    row.photoKey && ownerFaceKeys.has(row.photoKey),
  );
  const inheritedFace = row.faceId != null && ownerFaceIds.has(row.faceId);
  if (!inheritedPhoto && !inheritedFace) return false;

  console.log(
    `  face herdada zerada: ${row.name} (${row.id}) faceId=${row.faceId ?? '—'}`,
  );
  if (dryRun) return true;

  const previousFaceId = row.faceId;
  await db
    .update(schema.responsibles)
    .set({
      photoKey: null,
      faceId: null,
      deviceSyncStatus: null,
      deviceSyncedAt: null,
      deviceSyncError: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.responsibles.id, row.id));

  if (previousFaceId != null) {
    const stillUsed = await faceIdStillUsed(db, row.clientId, previousFaceId);
    if (!stillUsed) {
      await db
        .delete(schema.personReaderSync)
        .where(
          and(
            eq(schema.personReaderSync.clientId, row.clientId),
            eq(schema.personReaderSync.faceId, previousFaceId),
          ),
        );
    }
  }
  return true;
}

async function main() {
  if (!databaseUrl) {
    console.error('Defina DATABASE_URL no .env.');
    process.exit(1);
  }

  const sql = createPostgresClient(databaseUrl);
  const db = drizzle(sql, { schema }) as AppDb;

  console.log(
    apply
      ? 'Modo --apply: alterações serão gravadas.\n'
      : 'Dry-run (nenhuma alteração). Passe --apply para gravar.\n',
  );

  const sharedUsers = await db
    .select({
      userId: schema.responsibles.userId,
    })
    .from(schema.responsibles)
    .where(isNotNull(schema.responsibles.userId));

  const userIds = [
    ...new Set(
      sharedUsers
        .map((row) => row.userId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const counts = new Map<string, number>();
  for (const row of sharedUsers) {
    if (!row.userId) continue;
    counts.set(row.userId, (counts.get(row.userId) ?? 0) + 1);
  }
  const candidateUserIds = userIds.filter((id) => (counts.get(id) ?? 0) > 1);

  let accountsCreated = 0;
  let facesCleared = 0;
  let duplicatesMerged = 0;
  let groupsSplit = 0;

  for (const userId of candidateUserIds) {
    let rows = await loadResponsiblesByUser(db, userId);
    if (rows.length < 2) continue;

    const mergedHere = await mergeDuplicateRows(db, rows, !apply);
    duplicatesMerged += mergedHere;
    if (mergedHere > 0 && apply) {
      rows = await loadResponsiblesByUser(db, userId);
    }

    const byDoc = new Map<string, ResponsibleRow[]>();
    for (const row of rows) {
      const doc = digits(row.document);
      if (doc.length !== 11) continue;
      const list = byDoc.get(doc) ?? [];
      list.push(row);
      byDoc.set(doc, list);
    }
    if (byDoc.size <= 1) continue;

    const [user] = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        cpf: schema.users.cpf,
        name: schema.users.name,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user) continue;

    const ownerDoc = user.cpf && byDoc.has(user.cpf) ? user.cpf : null;
    if (!ownerDoc) {
      console.warn(
        `  skip ${userId} (${user.email}): user.cpf=${user.cpf ?? 'null'} não casa com nenhum responsável`,
      );
      continue;
    }

    const ownerRows = byDoc.get(ownerDoc) ?? [];
    const ownerFaceKeys = new Set(
      ownerRows.map((r) => r.photoKey).filter((k): k is string => Boolean(k)),
    );
    const ownerFaceIds = new Set(
      ownerRows.map((r) => r.faceId).filter((id): id is number => id != null),
    );

    groupsSplit += 1;
    console.log(
      `\nuser ${userId} ${user.email} cpf=${user.cpf}: ` +
        `dono ${ownerRows[0]?.name} [${ownerDoc}], ` +
        `${byDoc.size - 1} pessoa(s) a separar`,
    );

    for (const [doc, docRows] of byDoc) {
      if (doc === ownerDoc) continue;
      const displayName = docRows[0]?.name ?? doc;
      console.log(
        `  separar ${displayName} [${doc}] (${docRows.length} vínculo(s)) → nova conta nologin`,
      );

      let newUserId = `dry-run-${crypto.randomUUID()}`;
      if (apply) {
        newUserId = crypto.randomUUID();
        const passwordHash = await bcrypt.hash(crypto.randomUUID(), 10);
        await db.insert(schema.users).values({
          id: newUserId,
          email: nologinEmail(),
          password: passwordHash,
          name: displayName,
          cpf: doc,
          role: 'member',
          isActive: true,
        });
        accountsCreated += 1;
        await db
          .update(schema.responsibles)
          .set({ userId: newUserId, updatedAt: new Date() })
          .where(
            inArray(
              schema.responsibles.id,
              docRows.map((r) => r.id),
            ),
          );
      } else {
        accountsCreated += 1;
      }

      for (const row of docRows) {
        const cleared = await clearInheritedFace(
          db,
          row,
          ownerFaceKeys,
          ownerFaceIds,
          !apply,
        );
        if (cleared) facesCleared += 1;
      }
    }
  }

  console.log('\n--- Relatório ---');
  console.log(`Grupos com pessoas distintas: ${groupsSplit}`);
  console.log(`Contas criadas: ${accountsCreated}`);
  console.log(`Faces herdadas zeradas: ${facesCleared}`);
  console.log(`Duplicatas mescladas: ${duplicatesMerged}`);
  if (!apply) {
    console.log('\nNada foi gravado. Rode com --apply para aplicar.');
  }

  await endPostgresPool(sql);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
