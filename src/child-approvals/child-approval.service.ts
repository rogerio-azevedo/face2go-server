import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChildApprovalInvitationService } from './child-approval-invitation.service';
import { ChildApprovalPublicService } from './child-approval-public.service';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

import { PermissionsService } from '../permissions/permissions.service';
import { ChildApprovalRepository } from './child-approval.repository';
import { ChildApprovalRevocationService } from './child-approval-revocation.service';
import { ChildApprovalPolicyService } from './child-approval-policy.service';
import {
  ageForApproval,
  needsChildApproval,
  CHILD_APPROVAL_CHANGED,
} from './child-approval.util';

@Injectable()
export class ChildApprovalService {
  constructor(
    private readonly repository: ChildApprovalRepository,
    private readonly policy: ChildApprovalPolicyService,
    private readonly events: EventEmitter2,
    private readonly permissions: PermissionsService,
    private readonly invitations: ChildApprovalInvitationService,
    private readonly publicApproval: ChildApprovalPublicService,
    private readonly revocations: ChildApprovalRevocationService,
  ) {}

  requestEmails(clientId: string, registrationId: string, resend = false) {
    return this.invitations.requestEmails(clientId, registrationId, resend);
  }
  preview(token: string) {
    return this.publicApproval.preview(token);
  }
  accept(
    token: string,
    input: { cpf: string; agreed: true; termVersion: string },
  ) {
    return this.publicApproval.accept(token, input);
  }
  revokeOwn(token: string, cpf: string) {
    return this.publicApproval.revokeOwn(token, cpf);
  }

  async assertScope(user: JwtPayload, clientId: string, admin = false) {
    if (
      user.clientId === clientId &&
      (user.role === 'client_admin' ||
        (!admin && user.role === 'client_operator'))
    )
      return;
    const client = await this.repository.client(clientId);
    if (
      client &&
      client.companyId === user.companyId &&
      (user.role === 'company_admin' ||
        (!admin &&
          user.role === 'company_operator' &&
          (await this.permissions.evaluateCompanyFeatureAction(
            user.role,
            user.companyUserId,
            'clients',
            'can_read',
          ))))
    )
      return;
    throw new ForbiddenException('Sem permissão para este cliente.');
  }

  async deferApproval(
    clientId: string,
    registrationId: string,
    userId: string | null,
  ) {
    const [client, child] = await Promise.all([
      this.repository.client(clientId),
      this.repository.registration(clientId, registrationId),
    ]);
    if (
      !client ||
      !child ||
      !needsChildApproval(client, child) ||
      (await this.repository.activeConsentCount(clientId, registrationId)) > 0
    )
      return false;
    if (!child.isActive || !['draft', 'rejected'].includes(child.status))
      throw new BadRequestException('Cadastro não está aguardando aprovação.');
    await this.repository.requestApproval(clientId, registrationId, userId);
    await this.requestEmails(clientId, registrationId);
    return true;
  }

  async revokeAdmin(
    user: JwtPayload,
    clientId: string,
    consentId: string,
    reason: string,
    registrationId: string,
  ) {
    if (user.role !== 'client_admin' || user.clientId !== clientId)
      throw new ForbiddenException(
        'Somente o admin deste cliente pode revogar este aceite.',
      );
    const consent = await this.repository.consent(clientId, consentId);
    if (!consent || consent.registrationId !== registrationId)
      throw new NotFoundException('Aceite não encontrado.');
    await this.repository.transaction(async (db) => {
      await this.repository.registration(
        clientId,
        consent.registrationId,
        db,
        true,
      );
      await this.revocations.revoke(
        db,
        clientId,
        consentId,
        consent.registrationId,
        `admin:${user.sub}`,
        reason,
      );
    });
    await this.notify(CHILD_APPROVAL_CHANGED, clientId, consent.registrationId);
    return { success: true as const, message: 'Revogação registrada.' };
  }

  async regularize(user: JwtPayload, clientId: string, registrationId: string) {
    await this.assertScope(user, clientId, true);
    const client = await this.repository.client(clientId);
    if (!client?.enableChildApprove)
      throw new BadRequestException(
        'Ative a autorização de menores no cliente.',
      );
    await this.repository.transaction(async (db) => {
      const child = await this.repository.registration(
        clientId,
        registrationId,
        db,
        true,
      );
      const age = ageForApproval(
        child?.birthDate,
        client.timezoneOffsetMinutes,
      );
      if (
        !child?.isActive ||
        child.status !== 'approved' ||
        age == null ||
        age >= 18 ||
        !child.unitId ||
        child.childApprovalRequired
      )
        throw new BadRequestException(
          'Selecione um menor legado aprovado, com nascimento e unidade válidos.',
        );
      for (const faceId of await this.repository.faceIds(
        clientId,
        registrationId,
        db,
      ))
        await this.repository.lockFace(db, clientId, faceId);
      await this.repository.regularize(clientId, registrationId, user.sub, db);
    });
    await this.notify(CHILD_APPROVAL_CHANGED, clientId, registrationId);
    return {
      success: true as const,
      message:
        'Cadastro movido para rejeitados. Inicie a reaprovação para solicitar o aceite.',
    };
  }

  async history(user: JwtPayload, clientId: string, registrationId: string) {
    await this.assertScope(user, clientId);
    if (!(await this.repository.registration(clientId, registrationId)))
      throw new NotFoundException('Cadastro não encontrado.');
    const [summary, consents, requests] = await Promise.all([
      this.policy.summary(clientId, registrationId),
      this.repository.history(clientId, registrationId),
      this.repository.requests(clientId, registrationId),
    ]);
    return {
      summary,
      consents: consents.map((c) => ({
        id: c.id,
        adultSnapshot: c.adultSnapshot,
        childSnapshot: c.childSnapshot,
        termVersion: c.termVersion,
        termContent: c.termContent,
        termHash: c.termHash,
        acceptedAt: c.acceptedAt.toISOString(),
        revokedAt: c.revokedAt?.toISOString() ?? null,
        revokedBy: c.revokedBy,
        revocationReason: c.revocationReason,
      })),
      requests: await Promise.all(
        requests.map(async (r) => ({
          id: r.id,
          adultName:
            (
              await this.repository.registration(
                clientId,
                r.adultRegistrationId,
              )
            )?.name ?? 'Morador',
          emailSentAt: r.emailSentAt?.toISOString() ?? null,
          emailError: r.emailError,
          expiresAt: r.expiresAt.toISOString(),
          accepted: Boolean(r.acceptedAt),
          canceled: Boolean(r.canceledAt),
        })),
      ),
    };
  }

  async resend(user: JwtPayload, clientId: string, registrationId: string) {
    await this.assertScope(user, clientId);
    await this.requestEmails(clientId, registrationId, true);
    return {
      success: true as const,
      message: 'Solicitações preparadas para envio aos adultos elegíveis.',
    };
  }

  async notify(event: string, clientId: string, registrationId: string) {
    // O aceite já está persistido. Reconciliação periódica cobre falha no listener.
    await this.events
      .emitAsync(event, { clientId, registrationId })
      .catch(() => undefined);
  }
}
