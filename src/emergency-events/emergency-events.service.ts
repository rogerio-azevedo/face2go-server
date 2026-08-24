import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, eq } from 'drizzle-orm';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CompanyFeaturesService } from '../company-features/company-features.service';
import { DatabaseService } from '../database/database.service';
import * as clientsQueries from '../database/queries/clients.queries';
import * as emergencyQueries from '../database/queries/emergency-events.queries';
import * as membersQueries from '../database/queries/members.queries';
import * as presenceQueries from '../database/queries/presence.queries';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as studentsQueries from '../database/queries/students.queries';
import { emergencyCheckins, emergencyEvents } from '../database/schema';
import { PermissionsService } from '../permissions/permissions.service';
import type {
  AddEmergencyCheckinInput,
  CreateEmergencyEventInput,
  ResolveEmergencyEventInput,
  UpdateEmergencyCheckinInput,
} from '../validation/presence-emergency.schema';
import {
  EMERGENCY_CHECKIN_UPDATED,
  type EmergencyCheckinPayload,
  type EmergencyEventPayload,
  type EmergencySummaryPayload,
} from './emergency-events.events';
import { EmergencyGateway } from './emergency.gateway';

function buildSummary(
  checkins: EmergencyCheckinPayload[],
): EmergencySummaryPayload {
  const summary: EmergencySummaryPayload = {
    total: checkins.length,
    pending: 0,
    safe: 0,
    notLocated: 0,
    evacuated: 0,
    injured: 0,
  };
  for (const checkin of checkins) {
    if (checkin.status === 'pending') summary.pending += 1;
    else if (checkin.status === 'safe') summary.safe += 1;
    else if (checkin.status === 'not_located') summary.notLocated += 1;
    else if (checkin.status === 'evacuated') summary.evacuated += 1;
    else if (checkin.status === 'injured') summary.injured += 1;
  }
  return summary;
}

function toCheckinPayload(
  row: typeof emergencyCheckins.$inferSelect,
): EmergencyCheckinPayload {
  return {
    id: row.id,
    personType: row.personType,
    personId: row.personId,
    personName: row.personName,
    classId: row.classId ?? null,
    className: row.className ?? null,
    expectedStatus: row.expectedStatus,
    status: row.status,
    statusNote: row.statusNote ?? null,
    statusUpdatedAt: row.statusUpdatedAt
      ? row.statusUpdatedAt.toISOString()
      : null,
  };
}

@Injectable()
export class EmergencyEventsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly permissionsService: PermissionsService,
    private readonly companyFeaturesService: CompanyFeaturesService,
    private readonly eventEmitter: EventEmitter2,
    private readonly emergencyGateway: EmergencyGateway,
  ) {}

  private async assertPresenceFeatureEnabled(companyId: string): Promise<void> {
    const companyEnabled = await this.companyFeaturesService.isEnabled(
      companyId,
      'presence',
    );
    if (!companyEnabled) {
      throw new ForbiddenException('Sem permissão.');
    }
  }

  private async assertEmergencyWrite(user: JwtPayload): Promise<string> {
    const companyId = user.companyId ?? undefined;
    if (!companyId) throw new ForbiddenException('Sem permissão.');

    await this.assertPresenceFeatureEnabled(companyId);

    if (user.role === 'company_admin') return companyId;

    if (user.role === 'company_operator') {
      const ok = await this.permissionsService.evaluateCompanyFeatureAction(
        user.role,
        user.companyUserId,
        'presence',
        'can_update',
        companyId,
      );
      if (!ok) throw new ForbiddenException('Sem permissão.');
      return companyId;
    }

    if (user.role === 'client_admin') return companyId;

    throw new ForbiddenException('Sem permissão.');
  }

  private async assertEmergencyRead(user: JwtPayload): Promise<string> {
    const companyId = user.companyId ?? undefined;
    if (!companyId) throw new ForbiddenException('Sem permissão.');

    await this.assertPresenceFeatureEnabled(companyId);

    if (
      user.role === 'company_admin' ||
      user.role === 'company_operator' ||
      user.role === 'client_admin' ||
      user.role === 'client_operator'
    ) {
      if (user.role === 'company_operator') {
        const ok = await this.permissionsService.evaluateCompanyFeatureAction(
          user.role,
          user.companyUserId,
          'presence',
          'can_read',
          companyId,
        );
        if (!ok) throw new ForbiddenException('Sem permissão.');
      }
      return companyId;
    }

    throw new ForbiddenException('Sem permissão.');
  }

  private async buildEventPayload(
    eventId: string,
    companyId: string,
  ): Promise<EmergencyEventPayload> {
    const event = await emergencyQueries.getEmergencyEventById(
      this.database.db,
      eventId,
      companyId,
    );
    if (!event)
      throw new NotFoundException('Evento de emergência não encontrado.');

    const client = await clientsQueries.getClientById(
      this.database.db,
      event.clientId,
      companyId,
    );

    const checkinRows = await emergencyQueries.listEmergencyCheckins(
      this.database.db,
      eventId,
    );
    const checkins = checkinRows.map(toCheckinPayload);

    return {
      id: event.id,
      companyId: event.companyId,
      clientId: event.clientId,
      clientName: client?.name ?? '',
      status: event.status,
      srpAction: event.srpAction ?? null,
      reason: event.reason ?? null,
      startedAt: event.startedAt.toISOString(),
      resolvedAt: event.resolvedAt ? event.resolvedAt.toISOString() : null,
      summary: buildSummary(checkins),
      checkins,
    };
  }

  async activate(
    user: JwtPayload,
    clientId: string,
    input: CreateEmergencyEventInput,
  ): Promise<EmergencyEventPayload> {
    const companyId = await this.assertEmergencyWrite(user);

    const client = await clientsQueries.getClientById(
      this.database.db,
      clientId,
      companyId,
    );
    if (!client) throw new NotFoundException('Escola não encontrada.');

    if (user.role === 'client_admin' && user.clientId !== clientId) {
      throw new ForbiddenException('Sem permissão.');
    }

    const active = await emergencyQueries.getActiveEmergencyForClient(
      this.database.db,
      clientId,
    );
    if (active) {
      throw new ConflictException(
        'Já existe um evento de emergência ativo para esta escola.',
      );
    }

    const insidePeople = await emergencyQueries.listInsidePresenceForClient(
      this.database.db,
      clientId,
    );

    const studentIds = insidePeople
      .filter((p) => p.personType === 'student')
      .map((p) => p.personId);
    const classMap = await presenceQueries.listStudentClassNamesByStudentIds(
      this.database.db,
      studentIds,
    );

    const event = await this.database.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(emergencyEvents)
        .values({
          companyId,
          clientId,
          srpAction: input.srpAction ?? null,
          reason: input.reason ?? null,
          triggeredByUserId: user.sub,
          panicEventId: input.panicEventId ?? null,
        })
        .returning();

      if (!created) throw new Error('Falha ao criar evento de emergência.');

      if (insidePeople.length > 0) {
        await tx.insert(emergencyCheckins).values(
          insidePeople.map((person) => {
            const classInfo =
              person.personType === 'student'
                ? classMap.get(person.personId)
                : undefined;
            return {
              emergencyEventId: created.id,
              personType: person.personType,
              personId: person.personId,
              personName: person.personName,
              classId: classInfo?.classId ?? null,
              className: classInfo?.className ?? null,
              expectedStatus: 'inside' as const,
              status: 'pending' as const,
            };
          }),
        );
      }

      return created;
    });

    const payload = await this.buildEventPayload(event.id, companyId);
    this.emergencyGateway.emitEventSnapshot(event.id, payload);
    return payload;
  }

  async getById(
    user: JwtPayload,
    eventId: string,
  ): Promise<EmergencyEventPayload> {
    const companyId = await this.assertEmergencyRead(user);
    const event = await emergencyQueries.getEmergencyEventById(
      this.database.db,
      eventId,
      companyId,
    );
    if (!event)
      throw new NotFoundException('Evento de emergência não encontrado.');

    if (
      (user.role === 'client_admin' || user.role === 'client_operator') &&
      user.clientId !== event.clientId
    ) {
      throw new ForbiddenException('Sem permissão.');
    }

    return this.buildEventPayload(eventId, companyId);
  }

  async updateCheckin(
    user: JwtPayload,
    eventId: string,
    checkinId: string,
    input: UpdateEmergencyCheckinInput,
  ): Promise<EmergencyEventPayload> {
    const companyId = await this.assertEmergencyWrite(user);
    const event = await emergencyQueries.getEmergencyEventById(
      this.database.db,
      eventId,
      companyId,
    );
    if (!event)
      throw new NotFoundException('Evento de emergência não encontrado.');
    if (event.status !== 'active') {
      throw new ConflictException('Evento de emergência já encerrado.');
    }

    const checkin = await emergencyQueries.getEmergencyCheckinById(
      this.database.db,
      checkinId,
      eventId,
    );
    if (!checkin)
      throw new NotFoundException('Pessoa não encontrada na chamada.');

    const now = new Date();
    await this.database.db.transaction(async (tx) => {
      await tx
        .update(emergencyCheckins)
        .set({
          status: input.status,
          statusNote: input.note ?? null,
          statusUpdatedByUserId: user.sub,
          statusUpdatedAt: now,
        })
        .where(eq(emergencyCheckins.id, checkinId));

      await emergencyQueries.insertEmergencyStatusLog(tx, {
        emergencyEventId: eventId,
        checkinId,
        fromStatus: checkin.status,
        toStatus: input.status,
        note: input.note ?? null,
        byUserId: user.sub,
      });
    });

    const payload = await this.buildEventPayload(eventId, companyId);
    const updatedCheckin = payload.checkins.find((c) => c.id === checkinId);
    if (updatedCheckin) {
      this.emergencyGateway.emitCheckinUpdated({
        eventId,
        companyId,
        clientId: event.clientId,
        checkin: updatedCheckin,
        summary: payload.summary,
      });
    }
    this.eventEmitter.emit(EMERGENCY_CHECKIN_UPDATED, {
      eventId,
      companyId,
      clientId: event.clientId,
      checkin: updatedCheckin,
      summary: payload.summary,
    });
    return payload;
  }

  private async resolvePersonName(
    clientId: string,
    personType: AddEmergencyCheckinInput['personType'],
    personId: string,
  ): Promise<{
    name: string;
    classId: string | null;
    className: string | null;
  }> {
    if (personType === 'student') {
      const student = await studentsQueries.getStudentById(
        this.database.db,
        personId,
        clientId,
      );
      if (!student) throw new NotFoundException('Aluno não encontrado.');
      const classMap = await presenceQueries.listStudentClassNamesByStudentIds(
        this.database.db,
        [personId],
      );
      const classInfo = classMap.get(personId);
      return {
        name: student.name,
        classId: classInfo?.classId ?? null,
        className: classInfo?.className ?? null,
      };
    }

    if (personType === 'responsible') {
      const responsible = await responsiblesQueries.getResponsibleById(
        this.database.db,
        personId,
        clientId,
      );
      if (!responsible)
        throw new NotFoundException('Responsável não encontrado.');
      return { name: responsible.name, classId: null, className: null };
    }

    if (personType === 'member') {
      const member = await membersQueries.getMemberById(
        this.database.db,
        personId,
        clientId,
      );
      if (!member) throw new NotFoundException('Membro não encontrado.');
      return { name: member.name, classId: null, className: null };
    }

    throw new NotFoundException('Pessoa não encontrada.');
  }

  async addCheckin(
    user: JwtPayload,
    eventId: string,
    input: AddEmergencyCheckinInput,
  ): Promise<EmergencyEventPayload> {
    const companyId = await this.assertEmergencyWrite(user);
    const event = await emergencyQueries.getEmergencyEventById(
      this.database.db,
      eventId,
      companyId,
    );
    if (!event)
      throw new NotFoundException('Evento de emergência não encontrado.');
    if (event.status !== 'active') {
      throw new ConflictException('Evento de emergência já encerrado.');
    }

    const person = await this.resolvePersonName(
      event.clientId,
      input.personType,
      input.personId,
    );

    try {
      await this.database.db.insert(emergencyCheckins).values({
        emergencyEventId: eventId,
        personType: input.personType,
        personId: input.personId,
        personName: person.name,
        classId: person.classId,
        className: person.className,
        expectedStatus: 'added_manually',
        status: 'pending',
      });
    } catch (err: unknown) {
      if (
        err !== null &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code?: string }).code === '23505'
      ) {
        throw new ConflictException('Pessoa já está na chamada.');
      }
      throw err;
    }

    const payload = await this.buildEventPayload(eventId, companyId);
    this.emergencyGateway.emitEventSnapshot(eventId, payload);
    return payload;
  }

  async resolve(
    user: JwtPayload,
    eventId: string,
    input: ResolveEmergencyEventInput,
  ): Promise<EmergencyEventPayload> {
    const companyId = await this.assertEmergencyWrite(user);
    const event = await emergencyQueries.getEmergencyEventById(
      this.database.db,
      eventId,
      companyId,
    );
    if (!event)
      throw new NotFoundException('Evento de emergência não encontrado.');
    if (event.status !== 'active') {
      throw new ConflictException('Evento de emergência já encerrado.');
    }

    const now = new Date();
    await this.database.db
      .update(emergencyEvents)
      .set({
        status: 'resolved',
        resolvedAt: now,
        resolvedByUserId: user.sub,
        reason: input.note
          ? [event.reason, input.note].filter(Boolean).join(' | ')
          : event.reason,
      })
      .where(
        and(
          eq(emergencyEvents.id, eventId),
          eq(emergencyEvents.companyId, companyId),
        ),
      );

    const payload = await this.buildEventPayload(eventId, companyId);
    this.emergencyGateway.emitEventSnapshot(eventId, payload);
    return payload;
  }
}
