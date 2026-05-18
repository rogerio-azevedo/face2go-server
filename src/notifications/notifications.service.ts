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
import {
  ACCESS_FACIAL_RECORDED,
  type AccessFacialRecordedPayload,
} from './notifications.events';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Deve coincidir com `ANDROID_STUDENT_ACCESS_CHANNEL_ID` no app (Expo Notifications). */
const EXPO_PUSH_ANDROID_ACCESS_CHANNEL_ID = 'student_access';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly database: DatabaseService) { }

  async updatePushToken(responsibleId: string, pushToken: string): Promise<void> {
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
  async handleAccessRecorded(payload: AccessFacialRecordedPayload): Promise<void> {
    try {
      await this.notifyParentsOfStudentAccess(payload);
    } catch (err: unknown) {
      this.logger.warn(
        `Push pós-acesso falhou: ${err instanceof Error ? err.message : String(err)}`,
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
    const body = `${displayName} registrou entrada em ${payload.readerName}.`;

    await this.dispatchExpoPush(tokens, title, body, {
      type: 'student_access',
      studentId: student.id,
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
      this.logger.warn(
        `Expo push HTTP ${res.status}: ${text.slice(0, 500)}`,
      );
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
