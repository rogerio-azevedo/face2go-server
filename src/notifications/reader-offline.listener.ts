import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { DatabaseService } from '../database/database.service';
import * as clientUsersQueries from '../database/queries/client-users.queries';
import { EmailService } from '../email/email.service';
import {
  READER_OFFLINE_DETECTED,
  type ReaderOfflineDetectedEvent,
} from '../face-listener/face-listener.events';
import { MonitoringGateway } from '../realtime/monitoring.gateway';

@Injectable()
export class ReaderOfflineListener {
  private readonly logger = new Logger(ReaderOfflineListener.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly emailService: EmailService,
    private readonly monitoringGateway: MonitoringGateway,
  ) {}

  @OnEvent(READER_OFFLINE_DETECTED, { async: true })
  async handleReaderOffline(
    payload: ReaderOfflineDetectedEvent,
  ): Promise<void> {
    this.monitoringGateway.emitReaderOffline(payload);

    try {
      const admins = await clientUsersQueries.listActiveClientAdminEmails(
        this.database.db,
        payload.clientId,
      );
      if (admins.length === 0) {
        this.logger.warn(
          `Nenhum client_admin ativo para notificar (client=${payload.clientId} leitor="${payload.readerName}")`,
        );
        return;
      }

      await Promise.all(
        admins.map((admin) =>
          this.emailService
            .sendReaderOfflineEmail(
              admin.email,
              admin.name,
              payload.readerName,
              payload.clientName,
              payload.detectedAt,
            )
            .catch((err: unknown) => {
              this.logger.warn(
                `Falha ao enviar e-mail de leitor offline para ${admin.email}: ${
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
