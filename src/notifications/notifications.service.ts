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
  ACCESS_FACIAL_RECORDED,
  type AccessFacialRecordedPayload,
  INVITE_GUEST_FACE_SUBMITTED,
  type InviteGuestFaceSubmittedPayload,
  PICKUP_GUEST_FACE_SUBMITTED,
  type PickupGuestFaceSubmittedPayload,
  RESPONSIBLE_INVITATION_SUBMITTED,
  type ResponsibleInvitationSubmittedPayload,
} from './notifications.events';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Deve coincidir com `ANDROID_STUDENT_ACCESS_CHANNEL_ID` no app (Expo Notifications). */
const EXPO_PUSH_ANDROID_ACCESS_CHANNEL_ID = 'student_access';

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

  private accessVerb(readerDirection: AccessFacialRecordedPayload['readerDirection']): string {
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
    let responsibleIds = pickupAuths.map((auth) => auth.requestedByResponsibleId);

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
      payload.personName?.trim() ||
      primary.guestName?.trim() ||
      'Convidado';
    const body = `${displayName} ${verb} ${payload.readerName}.`;

    await this.dispatchExpoPush(tokens, title, body, {
      type: 'pickup_guest_access',
      accessId: payload.accessId,
      faceId: String(payload.faceId),
      clientId: payload.clientId,
    });
  }

  private async notifyMemberOfInviteGuestAccess(
    payload: AccessFacialRecordedPayload,
  ): Promise<void> {
    const inviteAuths = await visitorInviteQueries.inviteFindActiveByGuestFaceId(
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
      payload.personName?.trim() ||
      primary.guestName?.trim() ||
      'Visitante';
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
  ): Promise<void> {
    const messages = expoPushTokens.map((to) => ({
      to,
      sound: 'default' as const,
      title,
      body,
      data,
      priority: 'high' as const,
      channelId: EXPO_PUSH_ANDROID_ACCESS_CHANNEL_ID,
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
