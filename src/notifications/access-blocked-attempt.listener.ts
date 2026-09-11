import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { DatabaseService } from '../database/database.service';
import * as clientUsersQueries from '../database/queries/client-users.queries';
import { EmailService } from '../email/email.service';
import { MonitoringGateway } from '../realtime/monitoring.gateway';
import { R2StorageService } from '../storage/r2-storage.service';
import {
  ACCESS_BLOCKED_ATTEMPT,
  type AccessBlockedAttemptPayload,
} from './notifications.events';

@Injectable()
export class AccessBlockedAttemptListener {
  private readonly logger = new Logger(AccessBlockedAttemptListener.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly emailService: EmailService,
    private readonly monitoringGateway: MonitoringGateway,
    private readonly r2: R2StorageService,
  ) {}

  @OnEvent(ACCESS_BLOCKED_ATTEMPT, { async: true })
  async handleBlockedAttempt(
    payload: AccessBlockedAttemptPayload,
  ): Promise<void> {
    let snapUrl: string | null = null;
    if (payload.snapR2Key) {
      try {
        snapUrl = await this.r2.createPresignedGetUrl(payload.snapR2Key);
      } catch (err: unknown) {
        this.logger.debug(
          `Presign tentativa bloqueada falhou: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.monitoringGateway.emitBlockedAttempt({
      ...payload,
      snapUrl,
    });

    try {
      const admins = await clientUsersQueries.listActiveClientAdminEmails(
        this.database.db,
        payload.clientId,
      );
      if (admins.length === 0) {
        this.logger.warn(
          `Nenhum client_admin ativo para notificar (client=${payload.clientId} bloqueado="${payload.personName}")`,
        );
        return;
      }

      await Promise.all(
        admins.map((admin) =>
          this.emailService
            .sendBlockedAttemptEmail(
              admin.email,
              admin.name,
              payload.personName ?? `Face ${payload.faceId}`,
              payload.blockReason,
              payload.readerName,
              payload.clientName,
              payload.eventDate,
            )
            .catch((err: unknown) => {
              this.logger.warn(
                `Falha ao enviar e-mail de tentativa bloqueada para ${admin.email}: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            }),
        ),
      );
    } catch (err: unknown) {
      this.logger.warn(
        `Falha ao notificar admins do cliente ${payload.clientId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
