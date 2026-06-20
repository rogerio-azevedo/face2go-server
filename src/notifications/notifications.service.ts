import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { DatabaseService } from '../database/database.service';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as studentsQueries from '../database/queries/students.queries';
import * as pickupQueries from '../database/queries/pickup-authorizations.queries';
import * as visitorInviteQueries from '../database/queries/client-invites.queries';
import * as membersQueries from '../database/queries/members.queries';
import {
  PANIC_CREATED,
  type PanicCreatedEvent,
} from '../panic-events/panic-events.events';
import {
  ACCESS_FACIAL_RECORDED,
  type AccessFacialRecordedPayload,
  INVITE_GUEST_FACE_SUBMITTED,
  INVITE_GUEST_FACE_SYNCED,
  type InviteGuestFaceSubmittedPayload,
  type InviteGuestFaceSyncedPayload,
  PICKUP_GUEST_FACE_SUBMITTED,
  PICKUP_GUEST_FACE_SYNCED,
  type PickupGuestFaceSubmittedPayload,
  type PickupGuestFaceSyncedPayload,
  RESPONSIBLE_INVITATION_SUBMITTED,
  RESPONSIBLE_INVITATION_SYNCED,
  type ResponsibleInvitationSubmittedPayload,
  type ResponsibleInvitationSyncedPayload,
} from './notifications.events';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Deve coincidir com `ANDROID_STUDENT_ACCESS_CHANNEL_ID` no app (Expo Notifications). */
const EXPO_PUSH_ANDROID_ACCESS_CHANNEL_ID = 'student_access';

/** Deve coincidir com `ANDROID_PANIC_CHANNEL_ID` no app (Expo Notifications). */
const EXPO_PUSH_ANDROID_PANIC_CHANNEL_ID = 'panic_high';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly database: DatabaseService) {}

  async updatePushToken(
    responsibleId: string,
    pushToken: string,
  ): Promise<void> {
    const token = pushToken.trim();
    if (!token) {
      throw new BadRequestException('Token de push inválido.');
    }

    const row = await responsiblesQueries.updateResponsiblePushTokenById(
      this.database.db,
      responsibleId,
      token,
    );
    if (!row) {
      throw new NotFoundException('Responsável não encontrado.');
    }
  }

  async updateMemberPushToken(
    memberId: string,
    pushToken: string,
  ): Promise<void> {
    const token = pushToken.trim();
    if (!token) {
      throw new BadRequestException('Token de push inválido.');
    }

    const row = await membersQueries.updateMemberPushTokenById(
      this.database.db,
      memberId,
      token,
    );
    if (!row) {
      throw new NotFoundException('Membro não encontrado.');
    }
  }

  @OnEvent(ACCESS_FACIAL_RECORDED, { async: true })
  async handleAccessRecorded(
    payload: AccessFacialRecordedPayload,
  ): Promise<void> {
    try {
      await this.notifyParentsOfStudentAccess(payload);
    } catch (err: unknown) {
      this.logger.warn(
        `Push pós-acesso falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    try {
      await this.notifyParentsOfPickupGuestAccess(payload);
    } catch (err: unknown) {
      this.logger.warn(
        `Push pickup guest pós-acesso falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    try {
      await this.notifyMemberOfInviteGuestAccess(payload);
    } catch (err: unknown) {
      this.logger.warn(
        `Push invite guest pós-acesso falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  @OnEvent(PICKUP_GUEST_FACE_SUBMITTED, { async: true })
  async handlePickupGuestFaceSubmitted(
    payload: PickupGuestFaceSubmittedPayload,
  ): Promise<void> {
    try {
      const token = await responsiblesQueries.getResponsiblePushToken(
        this.database.db,
        payload.requestedByResponsibleId,
      );
      if (!token) {
        return;
      }
      await this.dispatchExpoPush(
        [token],
        'Cadastro de face pendente',
        `${payload.guestName} enviou a foto. Abra o app para aprovar.`,
        {
          type: 'pickup_guest_face_submitted',
          authorizationId: payload.authorizationId,
          clientId: payload.clientId,
        },
      );
    } catch (err: unknown) {
      this.logger.warn(
        `Push pickup face falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  @OnEvent(INVITE_GUEST_FACE_SUBMITTED, { async: true })
  async handleInviteGuestFaceSubmitted(
    payload: InviteGuestFaceSubmittedPayload,
  ): Promise<void> {
    try {
      const token = await membersQueries.getMemberPushToken(
        this.database.db,
        payload.requestedByMemberId,
      );
      if (!token) {
        return;
      }
      await this.dispatchExpoPush(
        [token],
        'Cadastro de visitante pendente',
        `${payload.guestName} enviou a foto. Abra o app para aprovar.`,
        {
          type: 'invite_guest_face_submitted',
          inviteId: payload.inviteId,
          clientId: payload.clientId,
        },
      );
    } catch (err: unknown) {
      this.logger.warn(
        `Push invite face falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  @OnEvent(PICKUP_GUEST_FACE_SYNCED, { async: true })
  async handlePickupGuestFaceSynced(
    payload: PickupGuestFaceSyncedPayload,
  ): Promise<void> {
    if (payload.syncStatus !== 'synced') {
      return;
    }
    try {
      const token = await responsiblesQueries.getResponsiblePushToken(
        this.database.db,
        payload.requestedByResponsibleId,
      );
      if (!token) {
        return;
      }
      const guestLabel = payload.guestName.trim() || 'Convidado';
      await this.dispatchExpoPush(
        [token],
        'Face sincronizada',
        `A autorização "${guestLabel}" teve a face sincronizada nos leitores.`,
        {
          type: 'pickup_guest_face_synced',
          authorizationId: payload.authorizationId,
          clientId: payload.clientId,
        },
      );
    } catch (err: unknown) {
      this.logger.warn(
        `Push pickup face synced falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  @OnEvent(INVITE_GUEST_FACE_SYNCED, { async: true })
  async handleInviteGuestFaceSynced(
    payload: InviteGuestFaceSyncedPayload,
  ): Promise<void> {
    if (payload.syncStatus !== 'synced') {
      return;
    }
    try {
      const token = await membersQueries.getMemberPushToken(
        this.database.db,
        payload.requestedByMemberId,
      );
      if (!token) {
        return;
      }
      const guestLabel = payload.guestName.trim() || 'Visitante';
      await this.dispatchExpoPush(
        [token],
        'Face sincronizada',
        `A autorização "${guestLabel}" teve a face sincronizada nos leitores.`,
        {
          type: 'invite_guest_face_synced',
          inviteId: payload.inviteId,
          clientId: payload.clientId,
        },
      );
    } catch (err: unknown) {
      this.logger.warn(
        `Push invite face synced falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  @OnEvent(RESPONSIBLE_INVITATION_SUBMITTED, { async: true })
  async handleResponsibleInvitationSubmitted(
    payload: ResponsibleInvitationSubmittedPayload,
  ): Promise<void> {
    try {
      const token = await responsiblesQueries.getResponsiblePushToken(
        this.database.db,
        payload.inviterResponsibleId,
      );
      if (!token) {
        return;
      }
      await this.dispatchExpoPush(
        [token],
        'Cadastro de responsável pendente',
        `${payload.guestName} enviou o cadastro. Abra o app para aprovar.`,
        {
          type: 'responsible_invitation_submitted',
          invitationId: payload.invitationId,
          clientId: payload.clientId,
        },
      );
    } catch (err: unknown) {
      this.logger.warn(
        `Push responsible invitation falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  @OnEvent(PANIC_CREATED, { async: true })
  async handlePanicCreated(payload: PanicCreatedEvent): Promise<void> {
    try {
      await this.notifyMembersOfPanic(payload.event);
    } catch (err: unknown) {
      this.logger.warn(
        `Push panic falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  @OnEvent(RESPONSIBLE_INVITATION_SYNCED, { async: true })
  async handleResponsibleInvitationSynced(
    payload: ResponsibleInvitationSyncedPayload,
  ): Promise<void> {
    if (payload.syncStatus !== 'synced') {
      return;
    }
    try {
      const token = await responsiblesQueries.getResponsiblePushToken(
        this.database.db,
        payload.inviterResponsibleId,
      );
      if (!token) {
        return;
      }
      const guestLabel = payload.guestName.trim() || 'Responsável';
      await this.dispatchExpoPush(
        [token],
        'Responsável sincronizado',
        `Face e veículo de "${guestLabel}" foram sincronizados e já têm acesso.`,
        {
          type: 'responsible_invitation_synced',
          invitationId: payload.invitationId,
          clientId: payload.clientId,
        },
      );
    } catch (err: unknown) {
      this.logger.warn(
        `Push responsible invitation synced falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async notifyParentsOfStudentAccess(
    payload: AccessFacialRecordedPayload,
  ): Promise<void> {
    const student = await studentsQueries.findStudentByFaceIdAndClientId(
      this.database.db,
      payload.faceId,
      payload.clientId,
    );
    if (!student) {
      return;
    }

    const targets =
      await responsiblesQueries.findResponsiblesWithPushTokenForStudent(
        this.database.db,
        student.id,
      );
    const tokens = [
      ...new Set(
        targets
          .map((t) => t.pushToken)
          .filter((t): t is string => typeof t === 'string' && t.length > 0),
      ),
    ];
    if (tokens.length === 0) {
      return;
    }

    const displayName = payload.personName?.trim() || student.name;
    const title = 'Acesso facial';
    const verb =
      payload.readerDirection === 'in'
        ? 'ENTROU em'
        : payload.readerDirection === 'out'
          ? 'SAIU de'
          : 'acessou';
    const body = `${displayName} ${verb} ${payload.readerName}.`;

    await this.dispatchExpoPush(tokens, title, body, {
      type: 'student_access',
      studentId: student.id,
      accessId: payload.accessId,
      faceId: String(payload.faceId),
      clientId: payload.clientId,
    });
  }

  private accessVerb(
    readerDirection: AccessFacialRecordedPayload['readerDirection'],
  ): string {
    if (readerDirection === 'in') {
      return 'ENTROU em';
    }
    if (readerDirection === 'out') {
      return 'SAIU de';
    }
    return 'acessou';
  }

  private collectPushTokens(
    targets: Array<{ pushToken: string | null }>,
  ): string[] {
    return [
      ...new Set(
        targets
          .map((t) => t.pushToken)
          .filter((t): t is string => typeof t === 'string' && t.length > 0),
      ),
    ];
  }

  private async notifyParentsOfPickupGuestAccess(
    payload: AccessFacialRecordedPayload,
  ): Promise<void> {
    const verb = this.accessVerb(payload.readerDirection);
    const title = 'Acesso facial';

    const responsible =
      await responsiblesQueries.findResponsibleByFaceIdAndClientId(
        this.database.db,
        payload.faceId,
        payload.clientId,
      );

    if (responsible) {
      const auths = await pickupQueries.pickupAuthFindActiveByLinkedResponsible(
        this.database.db,
        payload.clientId,
        responsible.id,
      );
      if (auths.length === 0) {
        return;
      }

      const responsibleIds = [
        ...new Set(auths.map((auth) => auth.requestedByResponsibleId)),
      ];
      const targets = await responsiblesQueries.findPushTokensByResponsibleIds(
        this.database.db,
        responsibleIds,
      );
      const tokens = this.collectPushTokens(targets);
      if (tokens.length === 0) {
        return;
      }

      const displayName = payload.personName?.trim() || responsible.name;
      const body = `${displayName} ${verb} ${payload.readerName} (autorizado por você).`;

      await this.dispatchExpoPush(tokens, title, body, {
        type: 'pickup_guest_access',
        accessId: payload.accessId,
        faceId: String(payload.faceId),
        clientId: payload.clientId,
      });
      return;
    }

    const pickupAuths = await pickupQueries.pickupAuthFindActiveByGuestFaceId(
      this.database.db,
      payload.clientId,
      payload.faceId,
    );
    if (pickupAuths.length === 0) {
      return;
    }

    const primary = pickupAuths[0];
    let responsibleIds = pickupAuths.map(
      (auth) => auth.requestedByResponsibleId,
    );

    const guestDocument = primary.guestDocument?.trim();
    if (guestDocument) {
      const docAuths = await pickupQueries.pickupAuthFindActiveByGuestDocument(
        this.database.db,
        payload.clientId,
        guestDocument,
      );
      responsibleIds = docAuths.map((auth) => auth.requestedByResponsibleId);
    }

    const uniqueIds = [...new Set(responsibleIds)];
    const targets = await responsiblesQueries.findPushTokensByResponsibleIds(
      this.database.db,
      uniqueIds,
    );
    const tokens = this.collectPushTokens(targets);
    if (tokens.length === 0) {
      return;
    }

    const displayName =
      payload.personName?.trim() || primary.guestName?.trim() || 'Convidado';
    const body = `${displayName} ${verb} ${payload.readerName}.`;

    await this.dispatchExpoPush(tokens, title, body, {
      type: 'pickup_guest_access',
      accessId: payload.accessId,
      faceId: String(payload.faceId),
      clientId: payload.clientId,
    });
  }

  async notifyMembersOfPanic(
    event: PanicCreatedEvent['event'],
  ): Promise<void> {
    const members = await membersQueries.listMembersWithPushTokenByClient(
      this.database.db,
      event.clientId,
      event.requesterUserId,
    );
    const tokens = this.collectPushTokens(members);
    if (tokens.length === 0) {
      return;
    }

    await this.dispatchExpoPush(
      tokens,
      'Pedido de socorro',
      `${event.requesterName} precisa de ajuda`,
      {
        type: 'panic_new',
        panicEventId: event.id,
        clientId: event.clientId,
        clientName: event.clientName,
        requesterName: event.requesterName,
        requesterRole: event.requesterRole,
        latitude: String(event.location.latitude),
        longitude: String(event.location.longitude),
        receivedAt: event.receivedAt,
      },
      EXPO_PUSH_ANDROID_PANIC_CHANNEL_ID,
    );
  }

  private async notifyMemberOfInviteGuestAccess(
    payload: AccessFacialRecordedPayload,
  ): Promise<void> {
    const inviteAuths =
      await visitorInviteQueries.inviteFindActiveByGuestFaceId(
        this.database.db,
        payload.clientId,
        payload.faceId,
      );
    if (inviteAuths.length === 0) {
      return;
    }

    const primary = inviteAuths[0];
    const token = await membersQueries.getMemberPushToken(
      this.database.db,
      primary.requestedByMemberId,
    );
    if (!token) {
      return;
    }

    const verb = this.accessVerb(payload.readerDirection);
    const title = 'Acesso facial';
    const displayName =
      payload.personName?.trim() || primary.guestName?.trim() || 'Visitante';
    const body = `${displayName} ${verb} ${payload.readerName}.`;

    await this.dispatchExpoPush([token], title, body, {
      type: 'invite_guest_access',
      accessId: payload.accessId,
      faceId: String(payload.faceId),
      clientId: payload.clientId,
    });
  }

  private async dispatchExpoPush(
    expoPushTokens: string[],
    title: string,
    body: string,
    data: Record<string, string>,
    channelId: string = EXPO_PUSH_ANDROID_ACCESS_CHANNEL_ID,
  ): Promise<void> {
    const messages = expoPushTokens.map((to) => ({
      to,
      sound: 'default' as const,
      title,
      body,
      data,
      priority: 'high' as const,
      channelId,
      ttl: 60,
    }));

    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.warn(`Expo push HTTP ${res.status}: ${text.slice(0, 500)}`);
      return;
    }

    const json = (await res.json()) as {
      data?: {
        status?: string;
        message?: string;
        details?: { error?: string };
      }[];
    };
    const results = json.data ?? [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r?.status === 'error') {
        this.logger.warn(
          `Expo push ticket erro: ${r.message ?? r.details?.error ?? 'unknown'} (índice ${i})`,
        );
      }
    }
  }
}
