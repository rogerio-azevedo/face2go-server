import { ageForApproval, needsVisitorApproval } from './visitor-approval.util';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReaderCredentialsCipher } from '../common/crypto/reader-credentials.cipher';
import type { EnvVars } from '../config/env.validation';
import { EmailService } from '../email/email.service';
import { VisitorApprovalDeliveryRepository } from './visitor-approval-delivery.repository';
import { VisitorApprovalRepository } from './visitor-approval.repository';

@Injectable()
export class VisitorApprovalDeliveryService {
  private readonly logger = new Logger(VisitorApprovalDeliveryService.name);
  constructor(
    private readonly outbox: VisitorApprovalDeliveryRepository,
    private readonly repository: VisitorApprovalRepository,
    private readonly email: EmailService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  async dispatch() {
    for (let i = 0; i < 20; i++) {
      const request = await this.outbox.claim();
      if (!request) return;
      let error: string | null = null;
      try {
        const [client, visitor, adult] = await Promise.all([
          this.repository.client(request.clientId),
          this.repository.registration(
            request.clientId,
            request.registrationId,
          ),
          this.repository.registration(
            request.clientId,
            request.adultRegistrationId,
          ),
        ]);
        if (
          !client?.enableVisitorApprove ||
          !visitor?.isActive ||
          !needsVisitorApproval(client, visitor) ||
          (ageForApproval(adult?.birthDate, client.timezoneOffsetMinutes) ??
            -1) < 18 ||
          !adult?.isActive ||
          adult.isVisitor ||
          adult.status !== 'approved' ||
          adult.isVisitor ||
          visitor.unitId !== request.unitId ||
          adult.unitId !== request.unitId ||
          adult.email !== request.email ||
          request.expiresAt < new Date()
        ) {
          await this.repository.updateRequest(request.clientId, request.id, {
            canceledAt: new Date(),
            emailLockedAt: null,
          });
          continue;
        }
        const token = createReaderCredentialsCipher(
          this.config.get('READER_ENCRYPTION_KEY', { infer: true }),
        ).decrypt(request.tokenEncrypted);
        await this.email.sendVisitorApprovalRequestEmail({
          to: request.email,
          adultName: adult.name ?? 'Morador',
          visitorName: visitor.name ?? 'Visitante',
          clientName: client.name,
          token,
        });
      } catch {
        // Não guardar mensagens de provedores que possam conter o token ou CPF.
        error = 'Não foi possível enviar a solicitação. Tente reenviar.';
        this.logger.warn(
          `Envio de autorização falhou: solicitação ${request.id}`,
        );
      }
      await this.outbox.finish(
        request.clientId,
        request.id,
        error,
        request.emailAttempts,
      );
    }
  }
}
