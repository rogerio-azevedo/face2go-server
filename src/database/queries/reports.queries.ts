import {
  and,
  asc,
  count,
  eq,
  exists,
  isNotNull,
  not,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import {
  clientMembers,
  clientRoles,
  facialReaders,
  responsibles,
  schoolClasses,
  studentClasses,
  students,
} from '../schema';
import { unaccentIlike } from './search-utils';
import * as studentClassesQueries from './student-classes.queries';

export type EnrollmentGroup = 'students' | 'responsibles' | 'members';

export type EnrollmentReportFilters = {
  clientId: string;
  group: EnrollmentGroup;
  classId?: string;
  search?: string;
  hasFace?: boolean;
  hasVehicle?: boolean;
  syncFailed?: boolean;
};

export type EnrollmentSummaryCounts = {
  total: number;
  withFace: number;
  withVehicle: number;
};

export type EnrollmentListRow = {
  id: string;
  name: string;
  className: string | null;
  roleName: string | null;
  photoKey: string | null;
  hasFace: boolean;
  hasVehicle: boolean;
  deviceSyncStatus: 'pending_sync' | 'synced' | 'sync_failed' | null;
  deviceSyncError: string | null;
  hasLogin: boolean;
};

export type EnrollmentListOptions = {
  offset?: number;
  limit?: number;
};

function toCount(value: unknown): number {
  return Number(value ?? 0);
}

function toBool(value: unknown): boolean {
  return value === true || value === 't' || value === 'true';
}

function hasCompleteFaceSql(faceId: AnyColumn, photoKey: AnyColumn): SQL {
  return sql`(${faceId} is not null and ${photoKey} is not null)`;
}

function hasCompleteFaceSelect(faceId: AnyColumn, photoKey: AnyColumn) {
  return sql<boolean>`(${faceId} is not null and ${photoKey} is not null)`.as(
    'hasFace',
  );
}

function nameSearch(column: AnyColumn, search?: string): SQL | undefined {
  const term = search?.trim();
  if (!term) return undefined;
  return unaccentIlike(column, term);
}

function studentClassExists(
  db: AppDb,
  studentIdCol: typeof students.id,
  classId: string,
) {
  return exists(
    db
      .select({ id: studentClasses.id })
      .from(studentClasses)
      .where(
        and(
          eq(studentClasses.studentId, studentIdCol),
          eq(studentClasses.classId, classId),
          eq(studentClasses.isActive, true),
        ),
      ),
  );
}

function responsibleHasVehicle() {
  return sql`exists (
    select 1 from vehicles v
    where v.responsible_id = ${responsibles.id}
      and v.client_id = ${responsibles.clientId}
  )`;
}

function memberHasVehicle() {
  return sql`exists (
    select 1 from vehicles v
    where v.member_id = ${clientMembers.id}
      and v.client_id = ${clientMembers.clientId}
  )`;
}

function matchBool(condition: SQL, value?: boolean): SQL | undefined {
  if (value === undefined) return undefined;
  return value ? condition : not(condition);
}

function studentWhere(
  db: AppDb,
  filters: EnrollmentReportFilters,
): SQL | undefined {
  const conditions: SQL[] = [
    eq(students.clientId, filters.clientId),
    eq(students.isActive, true),
  ];
  const searchCond = nameSearch(students.name, filters.search);
  if (searchCond) conditions.push(searchCond);
  if (filters.classId) {
    conditions.push(studentClassExists(db, students.id, filters.classId));
  }
  const faceCond = matchBool(
    hasCompleteFaceSql(students.faceId, students.photoKey),
    filters.hasFace,
  );
  if (faceCond) conditions.push(faceCond);
  if (filters.syncFailed) {
    conditions.push(eq(students.deviceSyncStatus, 'sync_failed'));
  }
  return and(...conditions);
}

function responsibleWhere(filters: EnrollmentReportFilters): SQL | undefined {
  const conditions: SQL[] = [
    eq(responsibles.clientId, filters.clientId),
    eq(responsibles.isActive, true),
  ];
  const searchCond = nameSearch(responsibles.name, filters.search);
  if (searchCond) conditions.push(searchCond);
  const faceCond = matchBool(
    hasCompleteFaceSql(responsibles.faceId, responsibles.photoKey),
    filters.hasFace,
  );
  if (faceCond) conditions.push(faceCond);
  const vehicleCond = matchBool(responsibleHasVehicle(), filters.hasVehicle);
  if (vehicleCond) conditions.push(vehicleCond);
  if (filters.syncFailed) {
    conditions.push(eq(responsibles.deviceSyncStatus, 'sync_failed'));
  }
  return and(...conditions);
}

function memberWhere(filters: EnrollmentReportFilters): SQL | undefined {
  const conditions: SQL[] = [
    eq(clientMembers.clientId, filters.clientId),
    eq(clientMembers.isActive, true),
  ];
  const searchCond = nameSearch(clientMembers.name, filters.search);
  if (searchCond) conditions.push(searchCond);
  const faceCond = matchBool(
    hasCompleteFaceSql(clientMembers.faceId, clientMembers.photoKey),
    filters.hasFace,
  );
  if (faceCond) conditions.push(faceCond);
  const vehicleCond = matchBool(memberHasVehicle(), filters.hasVehicle);
  if (vehicleCond) conditions.push(vehicleCond);
  if (filters.syncFailed) {
    conditions.push(eq(clientMembers.deviceSyncStatus, 'sync_failed'));
  }
  return and(...conditions);
}

async function summarizeStudents(
  db: AppDb,
  filters: EnrollmentReportFilters,
): Promise<EnrollmentSummaryCounts> {
  const [row] = await db
    .select({
      total: count(),
      withFace: sql<number>`(count(*) filter (where ${hasCompleteFaceSql(students.faceId, students.photoKey)}))::int`,
    })
    .from(students)
    .where(studentWhere(db, filters));

  return {
    total: toCount(row?.total),
    withFace: toCount(row?.withFace),
    withVehicle: 0,
  };
}

async function summarizeResponsibles(
  db: AppDb,
  filters: EnrollmentReportFilters,
): Promise<EnrollmentSummaryCounts> {
  const [row] = await db
    .select({
      total: count(),
      withFace: sql<number>`(count(*) filter (where ${hasCompleteFaceSql(responsibles.faceId, responsibles.photoKey)}))::int`,
      withVehicle: sql<number>`(count(*) filter (where ${responsibleHasVehicle()}))::int`,
    })
    .from(responsibles)
    .where(responsibleWhere(filters));

  return {
    total: toCount(row?.total),
    withFace: toCount(row?.withFace),
    withVehicle: toCount(row?.withVehicle),
  };
}

async function summarizeMembers(
  db: AppDb,
  filters: EnrollmentReportFilters,
): Promise<EnrollmentSummaryCounts> {
  const [row] = await db
    .select({
      total: count(),
      withFace: sql<number>`(count(*) filter (where ${hasCompleteFaceSql(clientMembers.faceId, clientMembers.photoKey)}))::int`,
      withVehicle: sql<number>`(count(*) filter (where ${memberHasVehicle()}))::int`,
    })
    .from(clientMembers)
    .where(memberWhere(filters));

  return {
    total: toCount(row?.total),
    withFace: toCount(row?.withFace),
    withVehicle: toCount(row?.withVehicle),
  };
}

export async function summarizeEnrollment(
  db: AppDb,
  filters: EnrollmentReportFilters,
): Promise<EnrollmentSummaryCounts> {
  if (filters.group === 'students') {
    return summarizeStudents(db, filters);
  }
  if (filters.group === 'responsibles') {
    return summarizeResponsibles(db, filters);
  }
  return summarizeMembers(db, filters);
}

async function attachStudentClassNames(
  db: AppDb,
  rows: Array<Omit<EnrollmentListRow, 'className'>>,
): Promise<EnrollmentListRow[]> {
  const links = await studentClassesQueries.listClassesByStudentIds(
    db,
    rows.map((row) => row.id),
  );
  const namesByStudent = new Map<string, string[]>();
  for (const link of links) {
    if (!link.isActive) continue;
    const current = namesByStudent.get(link.studentId) ?? [];
    if (!current.includes(link.className)) {
      current.push(link.className);
      namesByStudent.set(link.studentId, current);
    }
  }
  return rows.map((row) => ({
    ...row,
    className: namesByStudent.get(row.id)?.join(', ') ?? null,
  }));
}

async function listStudents(
  db: AppDb,
  filters: EnrollmentReportFilters,
  options: EnrollmentListOptions,
): Promise<EnrollmentListRow[]> {
  const q = db
    .select({
      id: students.id,
      name: students.name,
      photoKey: students.photoKey,
      hasFace: hasCompleteFaceSelect(students.faceId, students.photoKey),
      deviceSyncStatus: students.deviceSyncStatus,
      deviceSyncError: students.deviceSyncError,
    })
    .from(students)
    .where(studentWhere(db, filters))
    .orderBy(asc(students.name));

  if (options.limit !== undefined) q.limit(options.limit);
  if (options.offset !== undefined) q.offset(options.offset);

  const rows = await q;
  return attachStudentClassNames(
    db,
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      photoKey: row.photoKey ?? null,
      roleName: null,
      hasFace: toBool(row.hasFace),
      hasVehicle: false,
      deviceSyncStatus: row.deviceSyncStatus ?? null,
      deviceSyncError: row.deviceSyncError ?? null,
      hasLogin: false,
    })),
  );
}

async function listResponsibles(
  db: AppDb,
  filters: EnrollmentReportFilters,
  options: EnrollmentListOptions,
): Promise<EnrollmentListRow[]> {
  const q = db
    .select({
      id: responsibles.id,
      name: responsibles.name,
      photoKey: responsibles.photoKey,
      hasFace: hasCompleteFaceSelect(
        responsibles.faceId,
        responsibles.photoKey,
      ),
      hasVehicle: sql<boolean>`${responsibleHasVehicle()}`.as('hasVehicle'),
      deviceSyncStatus: responsibles.deviceSyncStatus,
      deviceSyncError: responsibles.deviceSyncError,
      userId: responsibles.userId,
    })
    .from(responsibles)
    .where(responsibleWhere(filters))
    .orderBy(asc(responsibles.name));

  if (options.limit !== undefined) q.limit(options.limit);
  if (options.offset !== undefined) q.offset(options.offset);

  const rows = await q;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    className: null,
    roleName: null,
    photoKey: row.photoKey ?? null,
    hasFace: toBool(row.hasFace),
    hasVehicle: toBool(row.hasVehicle),
    deviceSyncStatus: row.deviceSyncStatus ?? null,
    deviceSyncError: row.deviceSyncError ?? null,
    hasLogin: row.userId != null,
  }));
}

async function listMembers(
  db: AppDb,
  filters: EnrollmentReportFilters,
  options: EnrollmentListOptions,
): Promise<EnrollmentListRow[]> {
  const q = db
    .select({
      id: clientMembers.id,
      name: clientMembers.name,
      photoKey: clientMembers.photoKey,
      roleName: clientRoles.name,
      hasFace: hasCompleteFaceSelect(
        clientMembers.faceId,
        clientMembers.photoKey,
      ),
      hasVehicle: sql<boolean>`${memberHasVehicle()}`.as('hasVehicle'),
      deviceSyncStatus: clientMembers.deviceSyncStatus,
      deviceSyncError: clientMembers.deviceSyncError,
      userId: clientMembers.userId,
    })
    .from(clientMembers)
    .innerJoin(clientRoles, eq(clientMembers.roleId, clientRoles.id))
    .where(memberWhere(filters))
    .orderBy(asc(clientMembers.name));

  if (options.limit !== undefined) q.limit(options.limit);
  if (options.offset !== undefined) q.offset(options.offset);

  const rows = await q;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    className: null,
    roleName: row.roleName ?? null,
    photoKey: row.photoKey ?? null,
    hasFace: toBool(row.hasFace),
    hasVehicle: toBool(row.hasVehicle),
    deviceSyncStatus: row.deviceSyncStatus ?? null,
    deviceSyncError: row.deviceSyncError ?? null,
    hasLogin: row.userId != null,
  }));
}

export async function listEnrollment(
  db: AppDb,
  filters: EnrollmentReportFilters,
  options: EnrollmentListOptions = {},
): Promise<EnrollmentListRow[]> {
  if (filters.group === 'students') {
    return listStudents(db, filters, options);
  }
  if (filters.group === 'responsibles') {
    return listResponsibles(db, filters, options);
  }
  return listMembers(db, filters, options);
}

export async function hasActiveFacialReaders(
  db: AppDb,
  clientId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: facialReaders.id })
    .from(facialReaders)
    .where(
      and(
        eq(facialReaders.clientId, clientId),
        eq(facialReaders.isActive, true),
        isNotNull(facialReaders.username),
        isNotNull(facialReaders.passwordEncrypted),
        isNotNull(facialReaders.ip),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function listActiveSchoolClassesByClient(
  db: AppDb,
  clientId: string,
) {
  return db
    .select({
      id: schoolClasses.id,
      name: schoolClasses.name,
    })
    .from(schoolClasses)
    .where(
      and(
        eq(schoolClasses.clientId, clientId),
        eq(schoolClasses.isActive, true),
      ),
    )
    .orderBy(asc(schoolClasses.name));
}
