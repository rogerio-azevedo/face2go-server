import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import * as clientPanicConfigQueries from '../database/queries/client-panic-config.queries';
import * as clientsQueries from '../database/queries/clients.queries';
import * as membersQueries from '../database/queries/members.queries';
import { DatabaseService } from '../database/database.service';
import * as companyFeaturesQueries from '../database/queries/company-features.queries';
import { PermissionsService } from '../permissions/permissions.service';
import { CompanyFeaturesService } from '../company-features/company-features.service';
import {
  PanicEvent,
  type PanicEventDocument,
} from './panic-event.schema';
import {
  PANIC_CREATED,
  PANIC_UPDATED,
  type PanicEventPayload,
} from './panic-events.events';
import type {
  ClosePanicEventInput,
  CreatePanicEventInput,
  ListPanicEventsQuery,
  UpdateClientPanicConfigInput,
} from '../validation/panic-events.schema';

function toIso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

function toPayload(doc: PanicEventDocument): PanicEventPayload {
  return {
    id: String(doc._id),
    companyId: doc.companyId,
    clientId: doc.clientId,
    clientName: doc.clientName,
    eventType: doc.eventType,
    status: doc.status,
    requesterUserId: doc.requesterUserId,
    requesterMemberId: doc.requesterMemberId,
    requesterName: doc.requesterName,
    requesterRole: doc.requesterRole,
    location: {
      latitude: doc.location.latitude,
      longitude: doc.location.longitude,
      accuracy: doc.location.accuracy,
      capturedAt: doc.location.capturedAt.toISOString(),
      source: doc.location.source,
    },
    receivedAt: doc.receivedAt.toISOString(),
    claimedAt: toIso(doc.claimedAt),
    releasedAt: toIso(doc.releasedAt),
    closedAt: toIso(doc.closedAt),
    claimedBy: doc.claimedBy,
    closedBy: doc.closedBy,
    closingNotes: doc.closingNotes,
    closingReason: doc.closingReason,
  };
}

@Injectable()
export class PanicEventsService {
  constructor(
    @InjectModel(PanicEvent.name)
    private readonly panicEventModel: Model<PanicEventDocument>,
    private readonly database: DatabaseService,
    private readonly permissionsService: PermissionsService,
    private readonly companyFeaturesService: CompanyFeaturesService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private ensureCompany(user: JwtPayload): string {
    const companyId = user.companyId ?? undefined;
    if (!companyId) {
      throw new ForbiddenException('Sem permissão.');
    }
    return companyId;
  }

  private async assertMonitoringRead(user: JwtPayload): Promise<string> {
    const companyId = this.ensureCompany(user);

    const companyEnabled = await this.companyFeaturesService.isEnabled(
      companyId,
      'monitoring',
    );
    if (!companyEnabled) {
      throw new ForbiddenException('Sem permissão.');
    }

    if (user.role === 'company_admin') return companyId;
    if (user.role === 'company_operator') {
      const ok = await this.permissionsService.evaluateCompanyFeatureAction(
        user.role,
        user.companyUserId,
        'monitoring',
        'can_read',
        companyId,
      );
      if (!ok) throw new ForbiddenException('Sem permissão.');
      return companyId;
    }
    throw new ForbiddenException('Sem permissão.');
  }

  private actorFromUser(user: JwtPayload) {
    return {
      userId: user.sub,
      name: user.name ?? user.email,
      role: user.role,
    };
  }

  private async assertCanTriggerPanic(user: JwtPayload): Promise<{
    clientId: string;
    companyId: string;
    clientName: string;
    cooldownSeconds: number;
  }> {
    const clientId = user.clientId;
    if (!clientId) {
      throw new ForbiddenException('Contexto de cliente obrigatório.');
    }

    const client = await clientsQueries.getClientByIdOnly(
      this.database.db,
      clientId,
    );
    if (!client) {
      throw new NotFoundException('Cliente não encontrado.');
    }

    const companyEnabled = await this.companyFeaturesService.isEnabled(
      client.companyId,
      'monitoring',
    );
    if (!companyEnabled) {
      throw new ForbiddenException('Pedido de socorro não disponível.');
    }

    const permission = await clientPanicConfigQueries.isRoleAllowedForPanic(
      this.database.db,
      clientId,
      user.role,
    );
    if (!permission.allowed) {
      throw new ForbiddenException('Pedido de socorro não disponível.');
    }

    return {
      clientId,
      companyId: client.companyId,
      clientName: client.name,
      cooldownSeconds: permission.cooldownSeconds,
    };
  }

  async getPanicConfigForClient(user: JwtPayload, clientId: string) {
    if (user.role === 'member' || user.role === 'responsible') {
      if (user.clientId !== clientId) {
        throw new ForbiddenException('Sem permissão.');
      }
    } else if (user.role === 'company_admin' || user.role === 'company_operator') {
      const companyId = this.ensureCompany(user);
      const client = await clientsQueries.getClientById(
        this.database.db,
        clientId,
        companyId,
      );
      if (!client) throw new NotFoundException('Cliente não encontrado.');
    } else if (user.role === 'client_admin') {
      if (user.clientId !== clientId) {
        throw new ForbiddenException('Sem permissão.');
      }
    } else {
      throw new ForbiddenException('Sem permissão.');
    }

    const config = await clientPanicConfigQueries.ensurePanicConfig(
      this.database.db,
      clientId,
    );

    const companyId = await companyFeaturesQueries.getCompanyIdByClientId(
      this.database.db,
      clientId,
    );
    if (!companyId) {
      throw new NotFoundException('Cliente não encontrado.');
    }

    const companyEnabled = await this.companyFeaturesService.isEnabled(
      companyId,
      'monitoring',
    );
    if (!companyEnabled) {
      return {
        clientId: config.clientId,
        enabled: false,
        allowedRoles: [],
        cooldownSeconds: 0,
      };
    }

    return {
      clientId: config.clientId,
      enabled: config.enabled,
      allowedRoles: config.allowedRoles,
      cooldownSeconds: config.cooldownSeconds,
    };
  }

  async updatePanicConfig(
    user: JwtPayload,
    clientId: string,
    input: UpdateClientPanicConfigInput,
  ) {
    if (user.role === 'company_admin') {
      const companyId = this.ensureCompany(user);
      const client = await clientsQueries.getClientById(
        this.database.db,
        clientId,
        companyId,
      );
      if (!client) throw new NotFoundException('Cliente não encontrado.');
    } else if (user.role === 'client_admin') {
      if (user.clientId !== clientId) {
        throw new ForbiddenException('Sem permissão.');
      }
    } else {
      throw new ForbiddenException('Sem permissão.');
    }

    const updated = await clientPanicConfigQueries.upsertPanicConfig(
      this.database.db,
      clientId,
      input,
    );
    return {
      clientId: updated.clientId,
      enabled: updated.enabled,
      allowedRoles: updated.allowedRoles,
      cooldownSeconds: updated.cooldownSeconds,
    };
  }

  async create(user: JwtPayload, input: CreatePanicEventInput) {
    const scope = await this.assertCanTriggerPanic(user);

    const since = new Date(Date.now() - scope.cooldownSeconds * 1000);
    const recent = await this.panicEventModel
      .findOne({
        requesterUserId: user.sub,
        clientId: scope.clientId,
        receivedAt: { $gte: since },
        status: { $ne: 'closed' },
      })
      .sort({ receivedAt: -1 })
      .lean();
    if (recent) {
      throw new ConflictException(
        'Aguarde antes de enviar outro pedido de socorro.',
      );
    }

    let requesterMemberId: string | null = null;
    let requesterName = user.name ?? user.email;
    let requesterPushToken: string | null = null;

    if (user.role === 'member' && user.memberId) {
      requesterMemberId = user.memberId;
      const member = await membersQueries.getMemberWithRoleById(
        this.database.db,
        user.memberId,
        scope.clientId,
      );
      if (member) {
        requesterName = member.name;
        requesterPushToken = member.pushToken ?? null;
      }
    }

    const now = new Date();
    const doc = await this.panicEventModel.create({
      companyId: scope.companyId,
      clientId: scope.clientId,
      clientName: scope.clientName,
      eventType: 'panic',
      status: 'open',
      requesterUserId: user.sub,
      requesterMemberId,
      requesterName,
      requesterRole: user.role,
      requesterPushToken,
      location: {
        latitude: input.latitude,
        longitude: input.longitude,
        accuracy: input.accuracy ?? null,
        capturedAt: now,
        source: 'mobile_gps',
      },
      deviceInfo: input.deviceInfo ?? null,
      receivedAt: now,
      history: [
        {
          action: 'created',
          byUserId: user.sub,
          at: now,
          meta: null,
        },
      ],
    });

    const payload = toPayload(doc);
    this.eventEmitter.emit(PANIC_CREATED, { event: payload });
    return payload;
  }

  async list(user: JwtPayload, query: ListPanicEventsQuery) {
    const companyId = await this.assertMonitoringRead(user);
    const filter: Record<string, unknown> = { companyId };
    if (query.status) filter.status = query.status;
    if (query.clientId) filter.clientId = query.clientId;

    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.panicEventModel
        .find(filter)
        .sort({ receivedAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.panicEventModel.countDocuments(filter),
    ]);

    return {
      items: items.map((doc) => toPayload(doc)),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getById(user: JwtPayload, eventId: string) {
    const companyId = await this.assertMonitoringRead(user);
    if (!Types.ObjectId.isValid(eventId)) {
      throw new NotFoundException('Evento não encontrado.');
    }
    const doc = await this.panicEventModel.findOne({
      _id: eventId,
      companyId,
    });
    if (!doc) throw new NotFoundException('Evento não encontrado.');
    return toPayload(doc);
  }

  private async findCompanyEvent(
    companyId: string,
    eventId: string,
  ): Promise<PanicEventDocument> {
    if (!Types.ObjectId.isValid(eventId)) {
      throw new NotFoundException('Evento não encontrado.');
    }
    const doc = await this.panicEventModel.findOne({
      _id: eventId,
      companyId,
    });
    if (!doc) throw new NotFoundException('Evento não encontrado.');
    return doc;
  }

  async claim(user: JwtPayload, eventId: string) {
    const companyId = await this.assertMonitoringRead(user);
    const actor = this.actorFromUser(user);
    const now = new Date();

    const updated = await this.panicEventModel.findOneAndUpdate(
      { _id: eventId, companyId, status: 'open' },
      {
        $set: {
          status: 'claimed',
          claimedBy: actor,
          claimedAt: now,
        },
        $push: {
          history: {
            action: 'claim',
            byUserId: user.sub,
            at: now,
            meta: null,
          },
        },
      },
      { new: true },
    );

    if (!updated) {
      const existing = await this.findCompanyEvent(companyId, eventId);
      if (existing.status === 'claimed') {
        throw new ConflictException(
          `Evento já em tratativa por ${existing.claimedBy?.name ?? 'outro operador'}.`,
        );
      }
      throw new ConflictException('Evento não está disponível para tratativa.');
    }

    const payload = toPayload(updated);
    this.eventEmitter.emit(PANIC_UPDATED, { event: payload, action: 'claim' });
    return payload;
  }

  async release(user: JwtPayload, eventId: string) {
    const companyId = await this.assertMonitoringRead(user);
    const doc = await this.findCompanyEvent(companyId, eventId);

    if (doc.status !== 'claimed') {
      throw new ConflictException('Evento não está em tratativa.');
    }
    if (
      doc.claimedBy?.userId !== user.sub &&
      user.role !== 'company_admin'
    ) {
      throw new ForbiddenException('Apenas quem pegou o evento pode soltá-lo.');
    }

    const now = new Date();
    doc.status = 'open';
    doc.claimedBy = null;
    doc.claimedAt = null;
    doc.releasedAt = now;
    doc.history.push({
      action: 'release',
      byUserId: user.sub,
      at: now,
      meta: null,
    });
    await doc.save();

    const payload = toPayload(doc);
    this.eventEmitter.emit(PANIC_UPDATED, { event: payload, action: 'release' });
    return payload;
  }

  async close(
    user: JwtPayload,
    eventId: string,
    input: ClosePanicEventInput,
  ) {
    const companyId = await this.assertMonitoringRead(user);
    const doc = await this.findCompanyEvent(companyId, eventId);

    if (doc.status === 'closed') {
      throw new ConflictException('Evento já foi fechado.');
    }
    if (doc.status === 'claimed' && doc.claimedBy?.userId !== user.sub) {
      if (user.role !== 'company_admin') {
        throw new ForbiddenException(
          'Apenas quem está tratando o evento pode fechá-lo.',
        );
      }
    }

    const now = new Date();
    const actor = this.actorFromUser(user);
    doc.status = 'closed';
    doc.closedBy = actor;
    doc.closedAt = now;
    doc.closingNotes = input.closingNotes ?? null;
    doc.closingReason = input.closingReason;
    doc.history.push({
      action: 'close',
      byUserId: user.sub,
      at: now,
      meta: { closingReason: input.closingReason },
    });
    await doc.save();

    const payload = toPayload(doc);
    this.eventEmitter.emit(PANIC_UPDATED, { event: payload, action: 'close' });
    return payload;
  }
}
