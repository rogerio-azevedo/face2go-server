import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { VisitorApprovalRepository } from '../visitor-approvals/visitor-approval.repository';
import { ChildApprovalPolicyService } from '../child-approvals/child-approval-policy.service';
import {
  VISITOR_APPROVAL_ACCEPTED,
  VISITOR_APPROVAL_CHANGED,
} from '../visitor-approvals/visitor-approval.util';
import { ChildApprovalRemovalService } from '../face-sync/child-approval-removal.service';
import { FaceSyncService } from '../face-sync/face-sync.service';
import { RegistrationsAdminService } from './registrations-admin.service';

type Change = { clientId: string; registrationId: string };

@Injectable()
export class VisitorApprovalRegistrationListener {
  constructor(
    private readonly admin: RegistrationsAdminService,
    private readonly repository: VisitorApprovalRepository,
    private readonly policy: ChildApprovalPolicyService,
    private readonly removal: ChildApprovalRemovalService,
    private readonly faceSync: FaceSyncService,
  ) {}

  @OnEvent(VISITOR_APPROVAL_ACCEPTED)
  async accepted({ clientId, registrationId }: Change) {
    const visitor = await this.repository.registration(
      clientId,
      registrationId,
    );
    if (
      visitor?.visitorApprovalRequestedAt &&
      ['draft', 'rejected'].includes(visitor.status)
    ) {
      await this.admin.completeVisitorApproval(clientId, registrationId);
      return;
    }
    // Novo aceite após revogação/mudança de unidade de um cadastro já aprovado.
    if (
      visitor?.isActive &&
      ['approved', 'blocked'].includes(visitor.status) &&
      visitor.faceId != null &&
      (await this.policy.faceAllowed(clientId, visitor.faceId))
    ) {
      await this.faceSync.enqueueApprovedRegistrationJob(
        registrationId,
        clientId,
        undefined,
        { resetReaderProgress: true, blocked: visitor.status === 'blocked' },
      );
      await this.repository.clearApprovalIntent(clientId, registrationId);
    }
  }

  @OnEvent(VISITOR_APPROVAL_CHANGED)
  changed({ clientId, registrationId }: Change) {
    return this.removal.enqueue(clientId, registrationId);
  }
}
