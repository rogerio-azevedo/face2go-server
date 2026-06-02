import {
  and,
  asc,
  count,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  type SQL,
} from 'drizzle-orm';

import type { AppDb } from '../database.types';
import {
  responsibleStudents,
  responsibles,
  students,
  users,
} from '../schema';

import * as studentClassesQueries from './student-classes.queries';
import * as studentsQueries from './students.queries';

export type ResponsibleListQueryOptions = {
  search?: string;
  offset?: number;
  limit?: number;
};

function responsibleNameSearchCondition(search?: string): SQL | undefined {
  const term = search?.trim();
  if (!term) return undefined;
  return ilike(responsibles.name, `%${term}%`);
}

function responsibleClientWhere(clientId: string, search?: string) {
  const nameCond = responsibleNameSearchCondition(search);
  return nameCond
    ? and(eq(responsibles.clientId, clientId), nameCond)
    : eq(responsibles.clientId, clientId);
}

export async function listResponsiblesByClient(db: AppDb, clientId: string) {
  return db
    .select()
    .from(responsibles)
    .where(eq(responsibles.clientId, clientId))
    .orderBy(asc(responsibles.name));
}

export async function countResponsiblesByClient(
  db: AppDb,
  clientId: string,
  options: Pick<ResponsibleListQueryOptions, 'search'> = {},
) {
  const [row] = await db
    .select({ total: count() })
    .from(responsibles)
    .where(responsibleClientWhere(clientId, options.search));
  return Number(row?.total ?? 0);
}

export async function listResponsiblesByClientWithEmail(
  db: AppDb,
  clientId: string,
  options: ResponsibleListQueryOptions = {},
) {
  const q = db
    .select({
      responsible: responsibles,
      email: users.email,
    })
    .from(responsibles)
    .leftJoin(users, eq(responsibles.userId, users.id))
    .where(responsibleClientWhere(clientId, options.search))
    .orderBy(asc(responsibles.name));

  if (options.limit !== undefined) {
    q.limit(options.limit);
  }
  if (options.offset !== undefined) {
    q.offset(options.offset);
  }

  const rows = await q;
  return rows.map((r) => ({
    ...r.responsible,
    email: r.email ?? null,
  }));
}

export async function getResponsibleEmailByUserId(
  db: AppDb,
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.email ?? null;
}

/** Gestão web: todos os responsáveis da escola como opções de condutor (uso em veículos LPR). */
export async function listResponsibleDriverOptionsForClient(
  db: AppDb,
  clientId: string,
): Promise<HouseholdDriverOptionRow[]> {
  const rs = await listResponsiblesByClient(db, clientId);
  if (rs.length === 0) {
    return [];
  }
  const responsibleIds = rs.map((r) => r.id);
  const links = await db
    .select({
      responsibleId: responsibleStudents.responsibleId,
      relationshipType: responsibleStudents.relationshipType,
      createdAt: responsibleStudents.createdAt,
    })
    .from(responsibleStudents)
    .where(inArray(responsibleStudents.responsibleId, responsibleIds))
    .orderBy(asc(responsibleStudents.createdAt));

  const relationshipByResponsible = new Map<string, string>();
  for (const row of links) {
    if (!relationshipByResponsible.has(row.responsibleId)) {
      relationshipByResponsible.set(
        row.responsibleId,
        String(row.relationshipType),
      );
    }
  }

  return rs.map((r) => ({
    id: r.id,
    name: r.name,
    relationshipType: relationshipByResponsible.get(r.id) ?? 'other',
  }));
}

/** Responsáveis que compartilham pelo menos um aluno com `myResponsibleId` (inclui o próprio). */
export async function listHouseholdResponsibleIds(
  db: AppDb,
  myResponsibleId: string,
  clientId: string,
): Promise<string[]> {
  const studentIds = await studentsQueries.listStudentIdsForResponsible(
    db,
    myResponsibleId,
  );
  if (studentIds.length === 0) {
    return [myResponsibleId];
  }

  const rows = await db
    .select({ id: responsibleStudents.responsibleId })
    .from(responsibleStudents)
    .innerJoin(
      responsibles,
      eq(responsibleStudents.responsibleId, responsibles.id),
    )
    .where(
      and(
        inArray(responsibleStudents.studentId, studentIds),
        eq(responsibles.clientId, clientId),
        eq(responsibles.isActive, true),
      ),
    );

  const ids = [...new Set(rows.map((r) => r.id))];
  return ids.includes(myResponsibleId) ? ids : [...ids, myResponsibleId];
}

export type HouseholdDriverOptionRow = {
  id: string;
  name: string;
  relationshipType: string;
};

/** Condutores elegíveis: você + co-responsáveis pelos mesmos alunos (mesma escola). */
export async function listHouseholdDriverOptions(
  db: AppDb,
  myResponsibleId: string,
  clientId: string,
): Promise<HouseholdDriverOptionRow[]> {
  const studentIds = await studentsQueries.listStudentIdsForResponsible(
    db,
    myResponsibleId,
  );
  if (studentIds.length === 0) {
    const self = await getResponsibleById(db, myResponsibleId, clientId);
    if (!self) {
      return [];
    }
    return [
      {
        id: self.id,
        name: self.name,
        relationshipType: 'other',
      },
    ];
  }

  const rows = await db
    .select({
      id: responsibles.id,
      name: responsibles.name,
      relationshipType: responsibleStudents.relationshipType,
    })
    .from(responsibleStudents)
    .innerJoin(
      responsibles,
      eq(responsibleStudents.responsibleId, responsibles.id),
    )
    .where(
      and(
        inArray(responsibleStudents.studentId, studentIds),
        eq(responsibles.clientId, clientId),
        eq(responsibles.isActive, true),
      ),
    )
    .orderBy(asc(responsibles.name), asc(responsibleStudents.relationshipType));

  const byId = new Map<string, HouseholdDriverOptionRow>();
  for (const r of rows) {
    if (!byId.has(r.id)) {
      byId.set(r.id, {
        id: r.id,
        name: r.name,
        relationshipType: r.relationshipType,
      });
    }
  }
  return Array.from(byId.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR'),
  );
}

export async function listActiveResponsiblePeersExcept(
  db: AppDb,
  clientId: string,
  excludeResponsibleId: string,
) {
  return db
    .select({
      id: responsibles.id,
      name: responsibles.name,
    })
    .from(responsibles)
    .where(
      and(
        eq(responsibles.clientId, clientId),
        eq(responsibles.isActive, true),
        ne(responsibles.id, excludeResponsibleId),
      ),
    )
    .orderBy(asc(responsibles.name));
}

export async function getResponsibleFaceId(
  db: AppDb,
  responsibleId: string,
  clientId: string,
): Promise<number | null> {
  const rows = await db
    .select({ faceId: responsibles.faceId })
    .from(responsibles)
    .where(and(eq(responsibles.id, responsibleId), eq(responsibles.clientId, clientId)))
    .limit(1);
  const v = rows[0]?.faceId;
  return v == null ? null : v;
}

export async function getResponsibleWithFaceStatus(
  db: AppDb,
  id: string,
  clientId: string,
) {
  const rows = await db
    .select({
      photoKey: responsibles.photoKey,
      faceId: responsibles.faceId,
      deviceSyncStatus: responsibles.deviceSyncStatus,
      deviceSyncedAt: responsibles.deviceSyncedAt,
      deviceSyncError: responsibles.deviceSyncError,
    })
    .from(responsibles)
    .where(and(eq(responsibles.id, id), eq(responsibles.clientId, clientId)))
    .limit(1);
  return rows[0];
}

export async function getResponsibleById(
  db: AppDb,
  id: string,
  clientId: string,
) {
  const rows = await db
    .select()
    .from(responsibles)
    .where(and(eq(responsibles.id, id), eq(responsibles.clientId, clientId)))
    .limit(1);
  return rows[0];
}

export async function findResponsibleByDocumentAndClient(
  db: AppDb,
  clientId: string,
  document: string,
) {
  const [row] = await db
    .select()
    .from(responsibles)
    .where(
      and(eq(responsibles.clientId, clientId), eq(responsibles.document, document)),
    )
    .limit(1);
  return row;
}

export type UpsertResponsibleByDocumentInput = {
  clientId: string;
  document: string;
  name: string;
  phone?: string | null;
  isActive?: boolean;
};

export async function upsertResponsibleByDocument(
  db: AppDb,
  input: UpsertResponsibleByDocumentInput,
): Promise<{ row: typeof responsibles.$inferSelect; created: boolean }> {
  const existing = await findResponsibleByDocumentAndClient(
    db,
    input.clientId,
    input.document,
  );
  if (existing) {
    const row = await updateResponsible(db, existing.id, input.clientId, {
      name: input.name,
      phone: input.phone ?? existing.phone,
      isActive: input.isActive ?? existing.isActive,
    });
    return { row: row!, created: false };
  }
  const row = await insertResponsible(db, {
    clientId: input.clientId,
    name: input.name,
    document: input.document,
    phone: input.phone ?? null,
    isActive: input.isActive ?? true,
  });
  return { row: row!, created: true };
}

/** Responsável pelo face ID do leitor (chegada do pai/avô etc.). */
export async function findResponsibleByFaceIdAndClientId(
  db: AppDb,
  faceId: number,
  clientId: string,
) {
  const [row] = await db
    .select({
      id: responsibles.id,
      name: responsibles.name,
      photoKey: responsibles.photoKey,
    })
    .from(responsibles)
    .where(
      and(
        eq(responsibles.clientId, clientId),
        eq(responsibles.faceId, faceId),
        eq(responsibles.isActive, true),
      ),
    )
    .limit(1);
  return row;
}

export async function getResponsibleByUserId(db: AppDb, userId: string) {
  const rows = await db
    .select()
    .from(responsibles)
    .where(eq(responsibles.userId, userId))
    .limit(1);
  return rows[0];
}

export type ResponsibleInsert = typeof responsibles.$inferInsert;

export async function updateResponsiblePushTokenById(
  db: AppDb,
  responsibleId: string,
  pushToken: string,
) {
  const [row] = await db
    .update(responsibles)
    .set({ pushToken, updatedAt: new Date() })
    .where(eq(responsibles.id, responsibleId))
    .returning({ id: responsibles.id });
  return row;
}

export async function getResponsiblePushToken(
  db: AppDb,
  responsibleId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ pushToken: responsibles.pushToken })
    .from(responsibles)
    .where(
      and(
        eq(responsibles.id, responsibleId),
        eq(responsibles.isActive, true),
        isNotNull(responsibles.pushToken),
        ne(responsibles.pushToken, ''),
      ),
    )
    .limit(1);
  return row?.pushToken ?? null;
}

export async function findResponsibleIdsByStudentId(
  db: AppDb,
  studentId: string,
): Promise<Array<{ responsibleId: string }>> {
  return db
    .select({ responsibleId: responsibleStudents.responsibleId })
    .from(responsibleStudents)
    .where(eq(responsibleStudents.studentId, studentId));
}

export async function findResponsiblesWithPushTokenForStudent(
  db: AppDb,
  studentId: string,
) {
  return db
    .select({
      id: responsibles.id,
      pushToken: responsibles.pushToken,
    })
    .from(responsibleStudents)
    .innerJoin(
      responsibles,
      eq(responsibleStudents.responsibleId, responsibles.id),
    )
    .where(
      and(
        eq(responsibleStudents.studentId, studentId),
        eq(responsibles.isActive, true),
        isNotNull(responsibles.pushToken),
        ne(responsibles.pushToken, ''),
      ),
    );
}

export async function insertResponsible(
  db: AppDb,
  values: ResponsibleInsert,
) {
  const rows = await db.insert(responsibles).values(values).returning();
  return rows[0];
}

export async function linkUserToResponsible(
  db: AppDb,
  responsibleId: string,
  clientId: string,
  userId: string,
) {
  const [row] = await db
    .update(responsibles)
    .set({ userId, updatedAt: new Date() })
    .where(
      and(eq(responsibles.id, responsibleId), eq(responsibles.clientId, clientId)),
    )
    .returning();
  return row;
}

export async function updateResponsible(
  db: AppDb,
  id: string,
  clientId: string,
  values: Partial<
    Pick<
      typeof responsibles.$inferInsert,
      | 'name'
      | 'phone'
      | 'document'
      | 'faceId'
      | 'photoKey'
      | 'deviceSyncStatus'
      | 'deviceSyncedAt'
      | 'deviceSyncError'
      | 'pushToken'
      | 'isActive'
    >
  >,
) {
  const rows = await db
    .update(responsibles)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(responsibles.id, id), eq(responsibles.clientId, clientId)))
    .returning();
  return rows[0];
}

export async function updateResponsibleFace(
  db: AppDb,
  id: string,
  clientId: string,
  values: Partial<
    Pick<
      typeof responsibles.$inferInsert,
      | 'photoKey'
      | 'faceId'
      | 'deviceSyncStatus'
      | 'deviceSyncedAt'
      | 'deviceSyncError'
    >
  >,
) {
  return updateResponsible(db, id, clientId, values);
}

export async function insertResponsibleStudentLink(
  db: AppDb,
  values: typeof responsibleStudents.$inferInsert,
) {
  const [row] = await db.insert(responsibleStudents).values(values).returning();
  return row;
}

export async function deleteResponsibleStudentLink(
  db: AppDb,
  responsibleId: string,
  studentId: string,
) {
  const rows = await db
    .delete(responsibleStudents)
    .where(
      and(
        eq(responsibleStudents.responsibleId, responsibleId),
        eq(responsibleStudents.studentId, studentId),
      ),
    )
    .returning({ id: responsibleStudents.id });
  return rows[0];
}

/** Verifica se o responsável é pai ou mãe de pelo menos um aluno. */
export async function responsibleHasParentRelationship(
  db: AppDb,
  responsibleId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: responsibleStudents.id })
    .from(responsibleStudents)
    .where(
      and(
        eq(responsibleStudents.responsibleId, responsibleId),
        inArray(responsibleStudents.relationshipType, ['father', 'mother']),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function deleteAllResponsibleStudentLinks(
  db: AppDb,
  responsibleId: string,
) {
  return db
    .delete(responsibleStudents)
    .where(eq(responsibleStudents.responsibleId, responsibleId))
    .returning({ id: responsibleStudents.id });
}

type ResponsibleStudentPatch = Partial<
  Pick<
    typeof responsibleStudents.$inferInsert,
    'relationshipType' | 'isAuthorizedPickup'
  >
>;

export async function updateResponsibleStudentLink(
  db: AppDb,
  responsibleId: string,
  studentId: string,
  patch: ResponsibleStudentPatch,
) {
  if (Object.keys(patch).length === 0) {
    return undefined;
  }
  const [row] = await db
    .update(responsibleStudents)
    .set(patch)
    .where(
      and(
        eq(responsibleStudents.responsibleId, responsibleId),
        eq(responsibleStudents.studentId, studentId),
      ),
    )
    .returning();
  return row;
}

export async function listResponsibleStudentLinksWithStudents(
  db: AppDb,
  responsibleId: string,
  clientId: string,
) {
  const rows = await db
    .select({
      link: responsibleStudents,
      student: students,
    })
    .from(responsibleStudents)
    .innerJoin(students, eq(responsibleStudents.studentId, students.id))
    .where(
      and(
        eq(responsibleStudents.responsibleId, responsibleId),
        eq(students.clientId, clientId),
      ),
    )
    .orderBy(asc(responsibleStudents.createdAt));

  const studentIds = rows.map((r) => r.student.id);
  const links = await studentClassesQueries.listClassesByStudentIds(
    db,
    studentIds,
  );
  const firstClassByStudent = new Map<
    string,
    { name: string; year: number }
  >();
  for (const link of links) {
    if (link.isActive && !firstClassByStudent.has(link.studentId)) {
      firstClassByStudent.set(link.studentId, {
        name: link.className,
        year: link.year,
      });
    }
  }

  return rows.map((r) => ({
    link: r.link,
    student: r.student,
    schoolClass: firstClassByStudent.get(r.student.id) ?? null,
  }));
}

export async function listStudentResponsibleLinksWithResponsibles(
  db: AppDb,
  studentId: string,
  clientId: string,
) {
  const rows = await db
    .select({
      link: responsibleStudents,
      responsible: responsibles,
      email: users.email,
    })
    .from(responsibleStudents)
    .innerJoin(
      responsibles,
      eq(responsibleStudents.responsibleId, responsibles.id),
    )
    .leftJoin(users, eq(responsibles.userId, users.id))
    .innerJoin(students, eq(responsibleStudents.studentId, students.id))
    .where(
      and(
        eq(responsibleStudents.studentId, studentId),
        eq(students.clientId, clientId),
        eq(responsibles.clientId, clientId),
      ),
    )
    .orderBy(asc(responsibles.name));

  return rows.map((r) => ({
    link: r.link,
    responsible: {
      ...r.responsible,
      email: r.email ?? null,
    },
  }));
}

export async function listResponsibleIdsForStudent(
  db: AppDb,
  studentId: string,
  clientId: string,
): Promise<string[]> {
  const rows = await db
    .select({ responsibleId: responsibleStudents.responsibleId })
    .from(responsibleStudents)
    .innerJoin(
      responsibles,
      eq(responsibleStudents.responsibleId, responsibles.id),
    )
    .where(
      and(
        eq(responsibleStudents.studentId, studentId),
        eq(responsibles.clientId, clientId),
        eq(responsibles.isActive, true),
      ),
    );
  return [...new Set(rows.map((r) => r.responsibleId))];
}

export type ResponsibleForGlobalSyncRow = {
  id: string;
  name: string;
  faceId: number;
  photoKey: string;
};

/** Responsáveis com foto e sync pendente/falho — elegíveis para sync global. */
export async function listResponsiblesForGlobalSync(
  db: AppDb,
  clientId: string,
): Promise<ResponsibleForGlobalSyncRow[]> {
  const rows = await db
    .select({
      id: responsibles.id,
      name: responsibles.name,
      faceId: responsibles.faceId,
      photoKey: responsibles.photoKey,
    })
    .from(responsibles)
    .where(
      and(
        eq(responsibles.clientId, clientId),
        isNotNull(responsibles.faceId),
        isNotNull(responsibles.photoKey),
        or(
          ne(responsibles.deviceSyncStatus, 'synced'),
          isNull(responsibles.deviceSyncStatus),
        ),
      ),
    )
    .orderBy(asc(responsibles.name));

  return rows.filter(
    (r): r is ResponsibleForGlobalSyncRow =>
      r.faceId != null && r.photoKey != null,
  );
}

/** Mapa responsibleId → índices de zona (via alunos vinculados). */
export async function listActiveShiftZoneIndicesByResponsibleIds(
  db: AppDb,
  responsibleIds: string[],
): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  if (responsibleIds.length === 0) return result;

  const links = await db
    .select({
      responsibleId: responsibleStudents.responsibleId,
      studentId: responsibleStudents.studentId,
    })
    .from(responsibleStudents)
    .where(inArray(responsibleStudents.responsibleId, responsibleIds));

  const studentIds = [...new Set(links.map((l) => l.studentId))];
  const zonesByStudent =
    await studentClassesQueries.listActiveShiftZoneIndicesByStudentIds(
      db,
      studentIds,
    );

  const byResponsible = new Map<string, Set<number>>();
  for (const link of links) {
    const zones = zonesByStudent.get(link.studentId) ?? [];
    const set = byResponsible.get(link.responsibleId) ?? new Set<number>();
    for (const z of zones) set.add(z);
    byResponsible.set(link.responsibleId, set);
  }

  for (const [responsibleId, indices] of byResponsible) {
    result.set(responsibleId, [...indices].sort((a, b) => a - b));
  }
  return result;
}

/** União dos índices de zona dos turnos dos alunos vinculados ao responsável. */
export async function listActiveShiftZoneIndicesForResponsible(
  db: AppDb,
  responsibleId: string,
): Promise<number[]> {
  const studentLinks = await db
    .select({ studentId: responsibleStudents.studentId })
    .from(responsibleStudents)
    .where(eq(responsibleStudents.responsibleId, responsibleId));

  const indices = new Set<number>();
  for (const link of studentLinks) {
    const zones = await studentClassesQueries.listActiveShiftZoneIndicesForStudent(
      db,
      link.studentId,
    );
    for (const z of zones) indices.add(z);
  }

  return [...indices].sort((a, b) => a - b);
}
