import { and, count, eq, isNull } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import {
  cameras,
  clientMembers,
  clients,
  facialReaders,
  registrationLinks,
  responsibles,
  schoolClasses,
  students,
  vehicles,
} from '../schema';
import { countSubmittedRegistrationsByStatus } from './registrations.queries';

export type CompanyDashboardStats = {
  clients: number;
  students: number;
  responsibles: number;
  schoolClasses: number;
  vehicles: number;
  facialReaders: number;
  cameras: number;
};

export type ClientDashboardFacts = {
  members: number;
  students: number;
  responsibles: number;
  schoolClasses: number;
  vehicles: number;
  cameras: number;
  readers: number;
  activeRegistrationLinks: number;
  pendingRegistrations: number;
  approvedRegistrations: number;
};

async function countByClientId(
  db: AppDb,
  table:
    | typeof students
    | typeof responsibles
    | typeof schoolClasses
    | typeof vehicles
    | typeof facialReaders
    | typeof cameras,
  clientId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(table)
    .where(eq(table.clientId, clientId));
  return Number(row?.count ?? 0);
}

async function countByCompanyIdViaClients(
  db: AppDb,
  table:
    | typeof students
    | typeof responsibles
    | typeof schoolClasses
    | typeof vehicles
    | typeof facialReaders
    | typeof cameras,
  companyId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(table)
    .innerJoin(clients, eq(table.clientId, clients.id))
    .where(eq(clients.companyId, companyId));
  return Number(row?.count ?? 0);
}

async function countActiveByClientId(
  db: AppDb,
  table: typeof clientMembers | typeof students | typeof responsibles,
  clientId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(table)
    .where(and(eq(table.clientId, clientId), eq(table.isActive, true)));
  return Number(row?.count ?? 0);
}

async function countActiveRegistrationLinks(
  db: AppDb,
  clientId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(registrationLinks)
    .where(
      and(
        eq(registrationLinks.clientId, clientId),
        eq(registrationLinks.isActive, true),
        isNull(registrationLinks.deletedAt),
      ),
    );
  return Number(row?.count ?? 0);
}

export async function getClientDashboardFacts(
  db: AppDb,
  clientId: string,
): Promise<ClientDashboardFacts> {
  const [
    members,
    studentsCount,
    responsiblesCount,
    classesCount,
    vehiclesCount,
    readersCount,
    camerasCount,
    activeRegistrationLinks,
    registrationCounts,
  ] = await Promise.all([
    countActiveByClientId(db, clientMembers, clientId),
    countActiveByClientId(db, students, clientId),
    countActiveByClientId(db, responsibles, clientId),
    countByClientId(db, schoolClasses, clientId),
    countByClientId(db, vehicles, clientId),
    countByClientId(db, facialReaders, clientId),
    countByClientId(db, cameras, clientId),
    countActiveRegistrationLinks(db, clientId),
    countSubmittedRegistrationsByStatus(db, clientId),
  ]);

  return {
    members,
    students: studentsCount,
    responsibles: responsiblesCount,
    schoolClasses: classesCount,
    vehicles: vehiclesCount,
    cameras: camerasCount,
    readers: readersCount,
    activeRegistrationLinks,
    pendingRegistrations: registrationCounts.draft,
    approvedRegistrations: registrationCounts.approved,
  };
}

export async function getCompanyDashboardStats(
  db: AppDb,
  companyId: string,
): Promise<CompanyDashboardStats> {
  const [clientsRow] = await db
    .select({ count: count() })
    .from(clients)
    .where(eq(clients.companyId, companyId));

  const [
    studentsCount,
    responsiblesCount,
    classesCount,
    vehiclesCount,
    readersCount,
    camerasCount,
  ] = await Promise.all([
    countByCompanyIdViaClients(db, students, companyId),
    countByCompanyIdViaClients(db, responsibles, companyId),
    countByCompanyIdViaClients(db, schoolClasses, companyId),
    countByCompanyIdViaClients(db, vehicles, companyId),
    countByCompanyIdViaClients(db, facialReaders, companyId),
    countByCompanyIdViaClients(db, cameras, companyId),
  ]);

  return {
    clients: Number(clientsRow?.count ?? 0),
    students: studentsCount,
    responsibles: responsiblesCount,
    schoolClasses: classesCount,
    vehicles: vehiclesCount,
    facialReaders: readersCount,
    cameras: camerasCount,
  };
}
