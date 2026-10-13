import { Injectable } from '@nestjs/common';
import {
  ChildApprovalRepository,
  type ApprovalDb,
} from './child-approval.repository';
import { needsChildApproval } from './child-approval.util';

@Injectable()
export class ChildApprovalRevocationService {
  constructor(private readonly repository: ChildApprovalRepository) {}

  async revoke(
    db: ApprovalDb,
    clientId: string,
    consentId: string,
    registrationId: string,
    actor: string,
    reason: string,
  ) {
    await this.repository.rememberFaces(clientId, registrationId, db);
    for (const faceId of await this.repository.faceIds(
      clientId,
      registrationId,
      db,
    ))
      await this.repository.lockFace(db, clientId, faceId);
    await this.repository.revoke(clientId, consentId, actor, reason, db);
    await this.rejectIfUnauthorized(
      db,
      clientId,
      registrationId,
      actor.startsWith('admin:') ? actor.slice(6) : null,
    );
  }

  /** A rejeição e a intenção durável de remover faces pertencem à mesma transação. */
  async rejectIfUnauthorized(
    db: ApprovalDb,
    clientId: string,
    registrationId: string,
    authorUserId: string | null = null,
  ) {
    const child = await this.repository.registration(
      clientId,
      registrationId,
      db,
      true,
    );
    const client = await this.repository.client(clientId, db);
    if (
      !child ||
      !client ||
      !needsChildApproval(client, child) ||
      (await this.repository.activeConsentCount(clientId, registrationId, db)) >
        0
    )
      return false;
    // Não apagar uma nova intenção de reaprovação de um cadastro já rejeitado.
    if (child.status === 'rejected') return true;
    await this.repository.rememberFaces(clientId, registrationId, db);
    for (const faceId of await this.repository.faceIds(
      clientId,
      registrationId,
      db,
    ))
      await this.repository.lockFace(db, clientId, faceId);
    const now = new Date();
    const reason =
      'Autorização de menor revogada ou inválida: não há outro aceite válido.';
    await this.repository.patchRegistration(
      clientId,
      registrationId,
      {
        status: 'rejected',
        rejectionNotes: reason,
        childApprovalRemovalPending: true,
        childApprovalRequestedAt: null,
        childApprovalRequestedByUserId: null,
        updatedAt: now,
      },
      db,
    );
    await this.repository.deactivateMembers(clientId, registrationId, db);
    await this.repository.cancelOpenRequests(clientId, registrationId, db);
    await this.repository.recordRejection(
      clientId,
      registrationId,
      authorUserId,
      reason,
      db,
    );
    return true;
  }
}
