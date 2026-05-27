import { count, eq } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import {
  cameras,
  clients,
  facialReaders,
  responsibles,
  schoolClasses,
  students,
  vehicles,
} from '../schema';

export type CompanyDashboardStats = {
  clients: number;
  students: number;
  responsibles: number;
  schoolClasses: number;
  vehicles: number;
  facialReaders: number;
  cameras: number;
};

export type ClientDashboardStats = Omit<CompanyDashboardStats, 'clients'>;

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

export async function getClientDashboardStats(
  db: AppDb,
  clientId: string,
): Promise<ClientDashboardStats> {
  const [
    studentsCount,
    responsiblesCount,
    classesCount,
    vehiclesCount,
    readersCount,
    camerasCount,
  ] = await Promise.all([
    countByClientId(db, students, clientId),
    countByClientId(db, responsibles, clientId),
    countByClientId(db, schoolClasses, clientId),
    countByClientId(db, vehicles, clientId),
    countByClientId(db, facialReaders, clientId),
    countByClientId(db, cameras, clientId),
  ]);

  return {
    students: studentsCount,
    responsibles: responsiblesCount,
    schoolClasses: classesCount,
    vehicles: vehiclesCount,
    facialReaders: readersCount,
    cameras: camerasCount,
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
