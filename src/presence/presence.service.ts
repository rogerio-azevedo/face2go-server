import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CompanyFeaturesService } from '../company-features/company-features.service';
import { DatabaseService } from '../database/database.service';
import * as clientsQueries from '../database/queries/clients.queries';
import * as presenceQueries from '../database/queries/presence.queries';
import { PermissionsService } from '../permissions/permissions.service';

export type PresencePersonItem = {
  personId: string;
  personName: string;
  personType: 'student' | 'responsible' | 'member' | 'guest';
  status: 'in' | 'out';
  lastEventAt: string | null;
  lastSource: 'facial' | 'lpr' | null;
  lastDeviceName: string | null;
  classId: string | null;
  className: string | null;
};

export type PresenceCounts = {
  students: number;
  responsibles: number;
  members: number;
  guests: number;
  total: number;
};

export type SchoolPresenceResponse = {
  clientId: string;
  clientName: string;
  counts: PresenceCounts;
  people: PresencePersonItem[];
  deviceSummary: {
    readersTotal: number;
    readersWithDirection: number;
    camerasTotal: number;
    camerasWithDirection: number;
    hasDirectionConfigured: boolean;
  };
  activeEmergencyId: string | null;
};

export type CompanySchoolPresenceSummary = {
  clientId: string;
  clientName: string;
  counts: PresenceCounts;
  activeEmergencyId: string | null;
};

export type CompanyPresenceResponse = {
  schools: CompanySchoolPresenceSummary[];
  totals: PresenceCounts;
};

function countByType(
  people: Array<{ personType: PresencePersonItem['personType'] }>,
): PresenceCounts {
  const counts: PresenceCounts = {
    students: 0,
    responsibles: 0,
    members: 0,
    guests: 0,
    total: 0,
  };
  for (const person of people) {
    counts.total += 1;
    if (person.personType === 'student') counts.students += 1;
    else if (person.personType === 'responsible') counts.responsibles += 1;
    else if (person.personType === 'member') counts.members += 1;
    else counts.guests += 1;
  }
  return counts;
}

@Injectable()
export class PresenceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly permissionsService: PermissionsService,
    private readonly companyFeaturesService: CompanyFeaturesService,
  ) {}

  private async assertPresenceRead(user: JwtPayload): Promise<string> {
    const companyId = user.companyId ?? undefined;
    if (!companyId) {
      throw new ForbiddenException('Sem permissão.');
    }

    const companyEnabled = await this.companyFeaturesService.isEnabled(
      companyId,
      'presence',
    );
    if (!companyEnabled) {
      throw new ForbiddenException('Sem permissão.');
    }

    if (user.role === 'company_admin') return companyId;

    if (user.role === 'company_operator') {
      const ok = await this.permissionsService.evaluateCompanyFeatureAction(
        user.role,
        user.companyUserId,
        'presence',
        'can_read',
        companyId,
      );
      if (!ok) throw new ForbiddenException('Sem permissão.');
      return companyId;
    }

    if (user.role === 'client_admin' || user.role === 'client_operator') {
      if (!user.clientId) throw new ForbiddenException('Sem permissão.');
      const client = await clientsQueries.getClientById(
        this.database.db,
        user.clientId,
        companyId,
      );
      if (!client || client.companyId !== companyId) {
        throw new ForbiddenException('Sem permissão.');
      }
      return companyId;
    }

    throw new ForbiddenException('Sem permissão.');
  }

  private async buildPeopleItems(
    rows: Awaited<ReturnType<typeof presenceQueries.listPresenceByClient>>,
  ): Promise<PresencePersonItem[]> {
    const studentIds = rows
      .filter((row) => row.personType === 'student')
      .map((row) => row.personId);
    const classMap = await presenceQueries.listStudentClassNamesByStudentIds(
      this.database.db,
      studentIds,
    );

    return rows.map((row) => {
      const classInfo =
        row.personType === 'student' ? classMap.get(row.personId) : undefined;
      return {
        personId: row.personId,
        personName: row.personName,
        personType: row.personType,
        status: row.status,
        lastEventAt: row.lastEventAt ? row.lastEventAt.toISOString() : null,
        lastSource: row.lastSource ?? null,
        lastDeviceName: row.lastDeviceName ?? null,
        classId: classInfo?.classId ?? null,
        className: classInfo?.className ?? null,
      };
    });
  }

  async getClientPresence(
    user: JwtPayload,
    clientId: string,
    status: 'in' | 'out' = 'in',
  ): Promise<SchoolPresenceResponse> {
    const companyId = await this.assertPresenceRead(user);

    const client = await clientsQueries.getClientById(
      this.database.db,
      clientId,
      companyId,
    );
    if (!client) {
      throw new NotFoundException('Escola não encontrada.');
    }

    if (
      (user.role === 'client_admin' || user.role === 'client_operator') &&
      user.clientId !== clientId
    ) {
      throw new ForbiddenException('Sem permissão.');
    }

    const rows = await presenceQueries.listPresenceByClient(
      this.database.db,
      clientId,
      status,
    );
    const people = await this.buildPeopleItems(rows);
    const deviceSummary = await presenceQueries.getClientDeviceDirectionSummary(
      this.database.db,
      clientId,
    );

    const activeEmergency = await import(
      '../database/queries/emergency-events.queries'
    ).then((m) => m.getActiveEmergencyForClient(this.database.db, clientId));

    return {
      clientId,
      clientName: client.name,
      counts: countByType(people),
      people,
      deviceSummary: {
        ...deviceSummary,
        hasDirectionConfigured:
          deviceSummary.readersWithDirection > 0 ||
          deviceSummary.camerasWithDirection > 0,
      },
      activeEmergencyId: activeEmergency?.id ?? null,
    };
  }

  async getCompanyPresence(
    user: JwtPayload,
    clientId?: string,
    status: 'in' | 'out' = 'in',
  ): Promise<CompanyPresenceResponse | SchoolPresenceResponse> {
    const companyId = await this.assertPresenceRead(user);

    if (clientId) {
      return this.getClientPresence(user, clientId, status);
    }

    const rows = await presenceQueries.listPresenceByCompany(
      this.database.db,
      companyId,
      status,
    );

    const allClients = await clientsQueries.listClients(
      this.database.db,
      companyId,
    );
    const schoolClients = allClients.filter(
      (c) => c.type === 'school' && c.isActive,
    );

    const schoolsMap = new Map<string, CompanySchoolPresenceSummary>();
    for (const client of schoolClients) {
      schoolsMap.set(client.id, {
        clientId: client.id,
        clientName: client.name,
        counts: {
          students: 0,
          responsibles: 0,
          members: 0,
          guests: 0,
          total: 0,
        },
        activeEmergencyId: null,
      });
    }

    for (const row of rows) {
      let school = schoolsMap.get(row.clientId);
      if (!school) {
        school = {
          clientId: row.clientId,
          clientName: row.clientName,
          counts: {
            students: 0,
            responsibles: 0,
            members: 0,
            guests: 0,
            total: 0,
          },
          activeEmergencyId: null,
        };
        schoolsMap.set(row.clientId, school);
      }
      school.counts.total += 1;
      if (row.personType === 'student') school.counts.students += 1;
      else if (row.personType === 'responsible') school.counts.responsibles += 1;
      else if (row.personType === 'member') school.counts.members += 1;
      else school.counts.guests += 1;
    }

    const emergencyQueries = await import(
      '../database/queries/emergency-events.queries'
    );
    for (const school of schoolsMap.values()) {
      const active = await emergencyQueries.getActiveEmergencyForClient(
        this.database.db,
        school.clientId,
      );
      school.activeEmergencyId = active?.id ?? null;
    }

    const schools = [...schoolsMap.values()].sort((a, b) =>
      a.clientName.localeCompare(b.clientName),
    );

    const totals = schools.reduce<PresenceCounts>(
      (acc, school) => ({
        students: acc.students + school.counts.students,
        responsibles: acc.responsibles + school.counts.responsibles,
        members: acc.members + school.counts.members,
        guests: acc.guests + school.counts.guests,
        total: acc.total + school.counts.total,
      }),
      { students: 0, responsibles: 0, members: 0, guests: 0, total: 0 },
    );

    return { schools, totals };
  }
}
