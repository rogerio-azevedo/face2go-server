import { ChildApprovalDeliveryService } from './child-approval-delivery.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { randomBytes } from 'node:crypto';

import { createReaderCredentialsCipher } from '../common/crypto/reader-credentials.cipher';
import { isValidCpf } from '../common/utils/document';
import type { EnvVars } from '../config/env.validation';

import {
  ChildApprovalRepository,
  type ApprovalDb,
} from './child-approval.repository';

import {
  ageForApproval,
  approvalSnapshot,
  childApprovalTerm,
  hashApprovalToken,
  matchesAdultCpf,
  needsChildApproval,
  CHILD_APPROVAL_TERM_VERSION,
} from './child-approval.util';

@Injectable()
export class ChildApprovalInvitationService {
  constructor(
    private readonly repository: ChildApprovalRepository,
    private readonly config: ConfigService<EnvVars, true>,
    private readonly delivery: ChildApprovalDeliveryService,
  ) {}
  async requestEmails(
    clientId: string,
    registrationId: string,
    resend = false,
  ) {
    const [client, child] = await Promise.all([
      this.repository.client(clientId),
      this.repository.registration(clientId, registrationId),
    ]);
    if (
      !client ||
      !child?.isActive ||
      !needsChildApproval(client, child) ||
      !child.unitId ||
      (child.status === 'rejected' && !child.childApprovalRequestedAt)
    )
      return;
    const adults = (
      await this.repository.adultsInUnit(clientId, child.unitId)
    ).filter(
      (a) =>
        a.id !== child.id &&
        (ageForApproval(a.birthDate, client.timezoneOffsetMinutes) ?? -1) >=
          18 &&
        a.email &&
        a.document &&
        isValidCpf(a.document),
    );
    const existing = await this.repository.requests(clientId, registrationId);
    for (const adult of adults) {
      if (
        (await this.repository.history(clientId, registrationId)).some(
          (c) =>
            c.adultRegistrationId === adult.id &&
            !c.revokedAt &&
            c.unitId === child.unitId,
        )
      )
        continue;
      const open = existing.find(
        (r) =>
          r.adultRegistrationId === adult.id && !r.acceptedAt && !r.canceledAt,
      );
      if (open && open.unitId === child.unitId && open.expiresAt > new Date()) {
        if (resend)
          await this.repository.updateRequest(clientId, open.id, {
            emailSentAt: null,
            emailAttempts: 0,
            emailError: null,
            emailNextAttemptAt: new Date(),
          });
        continue;
      }
      const token = randomBytes(32).toString('hex');
      await this.repository.transaction(async (db) => {
        await this.repository.registration(clientId, registrationId, db, true);
        if (open)
          await this.repository.updateRequest(
            clientId,
            open.id,
            { canceledAt: new Date() },
            db,
          );
        await this.repository.insertRequest(
          {
            clientId,
            registrationId,
            adultRegistrationId: adult.id,
            unitId: child.unitId!,
            email: adult.email!,
            tokenHash: hashApprovalToken(token),
            tokenEncrypted: createReaderCredentialsCipher(
              this.config.get('READER_ENCRYPTION_KEY', { infer: true }),
            ).encrypt(token),
            termVersion: CHILD_APPROVAL_TERM_VERSION,
            termContent: childApprovalTerm(
              client.name,
              approvalSnapshot(child),
            ),
            expiresAt: new Date(Date.now() + 30 * 86400_000),
          },
          db,
        );
      });
    }
    await this.delivery.dispatch();
  }

  async bundle(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token))
      throw new NotFoundException('Link inválido.');
    const request = await this.repository.requestByHash(
      hashApprovalToken(token),
    );
    if (!request || request.canceledAt)
      throw new NotFoundException('Link inválido ou substituído.');
    const [client, child, adult] = await Promise.all([
      this.repository.client(request.clientId),
      this.repository.registration(request.clientId, request.registrationId),
      this.repository.registration(
        request.clientId,
        request.adultRegistrationId,
      ),
    ]);
    if (!client?.isActive || !child || !adult)
      throw new NotFoundException('Link indisponível.');
    return { request, client, child, adult };
  }

  async verifyCpf(
    db: ApprovalDb,
    request: NonNullable<
      Awaited<ReturnType<ChildApprovalRepository['lockedRequest']>>
    >,
    expected: string | null,
    input: string,
  ) {
    if (request.lockedUntil && request.lockedUntil > new Date())
      return 'Limite de tentativas atingido. Tente novamente em 15 minutos.';
    if (matchesAdultCpf(input, expected)) return null;
    const failures = request.lockedUntil ? 1 : request.verificationFailures + 1;
    await this.repository.updateRequest(
      request.clientId,
      request.id,
      {
        verificationFailures: failures,
        lockedUntil: failures >= 5 ? new Date(Date.now() + 15 * 60_000) : null,
      },
      db,
    );
    return 'Não foi possível confirmar o CPF deste cadastro.';
  }
}
