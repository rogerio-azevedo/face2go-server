import { BadRequestException, Injectable } from '@nestjs/common';

import { EventEmitter2 } from '@nestjs/event-emitter';

import { VisitorApprovalRepository } from './visitor-approval.repository';
import { VisitorApprovalRevocationService } from './visitor-approval-revocation.service';

import {
  ageForApproval,
  needsVisitorApproval,
  approvalSnapshot,
  hashApprovalToken,
  VISITOR_APPROVAL_ACCEPTED,
  VISITOR_APPROVAL_CHANGED,
} from './visitor-approval.util';

import { VisitorApprovalInvitationService } from './visitor-approval-invitation.service';
import { canViewVisitorApprovalPhoto } from './visitor-approval-photo.service';
@Injectable()
export class VisitorApprovalPublicService {
  constructor(
    private readonly repository: VisitorApprovalRepository,
    private readonly invitations: VisitorApprovalInvitationService,
    private readonly events: EventEmitter2,
    private readonly revocations: VisitorApprovalRevocationService,
  ) {}
  async preview(token: string) {
    const { request, client, visitor, adult } =
      await this.invitations.bundle(token);
    const consent = await this.repository.consentByRequest(
      client.id,
      request.id,
    );
    const adultAvailable = await this.repository.adultAvailable(
      client.id,
      adult.id,
    );
    return {
      clientName: client.name,
      visitorName: visitor.name ?? 'Visitante',
      hasPhoto:
        adultAvailable &&
        canViewVisitorApprovalPhoto(
          { request, client, visitor, adult },
          consent,
        ),
      adultName: adult.name ?? 'Morador',
      block: visitor.additionalData?.block ?? null,
      unit: visitor.additionalData?.unit ?? null,
      termVersion: request.termVersion,
      termContent: request.termContent,
      accepted: Boolean(consent),
      revoked: Boolean(consent?.revokedAt),
      canAccept:
        adultAvailable &&
        client.enableVisitorApprove &&
        needsVisitorApproval(client, visitor) &&
        (ageForApproval(adult.birthDate, client.timezoneOffsetMinutes) ?? -1) >=
          18 &&
        visitor.isActive &&
        adult.isActive &&
        adult.status === 'approved' &&
        !adult.isVisitor &&
        adult.unitId === request.unitId &&
        visitor.unitId === request.unitId &&
        request.expiresAt > new Date() &&
        !request.acceptedAt,
    };
  }

  async accept(
    token: string,
    input: { cpf: string; agreed: true; termVersion: string },
  ) {
    const bundle = await this.invitations.bundle(token);
    const result = await this.repository.transaction(async (db) => {
      const visitor = await this.repository.registration(
        bundle.client.id,
        bundle.visitor.id,
        db,
        true,
      );
      const request = await this.repository.lockedRequest(
        bundle.client.id,
        bundle.request.id,
        db,
      );
      const adult = await this.repository.registration(
        bundle.client.id,
        bundle.adult.id,
        db,
        true,
      );
      const client = await this.repository.client(bundle.client.id, db);
      if (
        !request ||
        request.canceledAt ||
        !visitor ||
        !adult ||
        !client?.enableVisitorApprove ||
        !client.isActive
      )
        return 'Solicitação indisponível.';
      const cpfError = await this.invitations.verifyCpf(
        db,
        request,
        adult.document,
        input.cpf,
      );
      if (cpfError) return cpfError;
      if (request.acceptedAt) {
        const consent = await this.repository.consentByRequest(
          client.id,
          request.id,
          db,
        );
        return consent?.revokedAt
          ? 'Este aceite foi revogado. Solicite um novo link.'
          : null;
      }
      if (
        !needsVisitorApproval(client, visitor) ||
        !visitor.isActive ||
        (visitor.status === 'rejected' &&
          !visitor.visitorApprovalRequestedAt) ||
        !(await this.repository.adultAvailable(client.id, adult.id, db)) ||
        !adult.isActive ||
        adult.status !== 'approved' ||
        adult.isVisitor ||
        adult.unitId !== visitor.unitId ||
        visitor.unitId !== request.unitId ||
        (ageForApproval(adult.birthDate, client.timezoneOffsetMinutes) ?? -1) <
          18 ||
        request.expiresAt < new Date() ||
        input.termVersion !== request.termVersion ||
        input.agreed !== true
      )
        return 'Solicitação expirada ou cadastro não elegível. Solicite novo link.';
      await this.repository.rememberFaces(client.id, visitor.id, db);
      for (const faceId of await this.repository.faceIds(
        client.id,
        visitor.id,
        db,
      ))
        await this.repository.lockFace(db, client.id, faceId);
      await this.repository.insertConsent(
        {
          clientId: client.id,
          registrationId: visitor.id,
          adultRegistrationId: adult.id,
          requestId: request.id,
          unitId: request.unitId,
          visitorSnapshot: approvalSnapshot(visitor),
          adultSnapshot: approvalSnapshot(adult),
          termVersion: request.termVersion,
          termContent: request.termContent,
          termHash: hashApprovalToken(request.termContent),
        },
        db,
      );
      await this.repository.updateRequest(
        client.id,
        request.id,
        { acceptedAt: new Date(), verificationFailures: 0, lockedUntil: null },
        db,
      );
      return null;
    });
    if (result) throw new BadRequestException(result);
    await this.notify(
      VISITOR_APPROVAL_ACCEPTED,
      bundle.client.id,
      bundle.visitor.id,
    );
    return {
      success: true as const,
      message:
        'Autorização registrada. O acesso depende das demais autorizações, da aprovação do cadastro e da sincronização nos leitores.',
    };
  }

  async revokeOwn(token: string, cpf: string) {
    const { request, client, visitor, adult } =
      await this.invitations.bundle(token);
    const error = await this.repository.transaction(async (db) => {
      await this.repository.registration(client.id, visitor.id, db, true);
      const locked = await this.repository.lockedRequest(
        client.id,
        request.id,
        db,
      );
      const freshAdult = await this.repository.registration(
        client.id,
        adult.id,
        db,
      );
      if (!locked || !freshAdult) return 'Solicitação inválida.';
      const error = await this.invitations.verifyCpf(
        db,
        locked,
        freshAdult.document,
        cpf,
      );
      if (error) return error;
      const consent = await this.repository.consentByRequest(
        client.id,
        request.id,
        db,
      );
      if (!consent) return 'Não há aceite para revogar.';
      await this.revocations.revoke(
        db,
        client.id,
        consent.id,
        visitor.id,
        `adult:${adult.id}`,
        'Revogado pelo autor do aceite.',
      );
      return null;
    });
    if (error) throw new BadRequestException(error);
    await this.notify(VISITOR_APPROVAL_CHANGED, client.id, visitor.id);
    return {
      success: true as const,
      message:
        'Seu aceite foi revogado. O acesso é retirado se não houver outra autorização válida.',
    };
  }

  async notify(event: string, clientId: string, registrationId: string) {
    // O aceite já está persistido. Reconciliação periódica cobre falha no listener.
    await this.events
      .emitAsync(event, { clientId, registrationId })
      .catch(() => undefined);
  }
}
