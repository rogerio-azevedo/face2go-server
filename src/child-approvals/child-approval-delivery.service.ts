import { ageForApproval, needsChildApproval } from './child-approval.util';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReaderCredentialsCipher } from '../common/crypto/reader-credentials.cipher';
import type { EnvVars } from '../config/env.validation';
import { EmailService } from '../email/email.service';
import { ChildApprovalDeliveryRepository } from './child-approval-delivery.repository';
import { ChildApprovalRepository } from './child-approval.repository';

@Injectable()
export class ChildApprovalDeliveryService {
  private readonly logger = new Logger(ChildApprovalDeliveryService.name);
  constructor(
    private readonly outbox: ChildApprovalDeliveryRepository,
    private readonly repository: ChildApprovalRepository,
    private readonly email: EmailService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  async dispatch() {
    for (let i = 0; i < 20; i++) {
      const request = await this.outbox.claim();
      if (!request) return;
      let error: string | null = null;
      try {
        const [client, child, adult] = await Promise.all([
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
          !client?.enableChildApprove ||
          !child?.isActive ||
          !needsChildApproval(client, child) ||
          (ageForApproval(adult?.birthDate, client.timezoneOffsetMinutes) ??
            -1) < 18 ||
          !adult?.isActive ||
          adult.isVisitor ||
          adult.status !== 'approved' ||
          adult.isVisitor ||
          child.unitId !== request.unitId ||
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
        await this.email.sendChildApprovalRequestEmail({
          to: request.email,
          adultName: adult.name ?? 'Morador',
          childName: child.name ?? 'Menor',
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
