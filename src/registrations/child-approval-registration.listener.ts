import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ChildApprovalRepository } from '../child-approvals/child-approval.repository';
import { ChildApprovalPolicyService } from '../child-approvals/child-approval-policy.service';
import {
  CHILD_APPROVAL_ACCEPTED,
  CHILD_APPROVAL_CHANGED,
} from '../child-approvals/child-approval.util';
import { ChildApprovalRemovalService } from '../face-sync/child-approval-removal.service';
import { FaceSyncService } from '../face-sync/face-sync.service';
import { RegistrationsAdminService } from './registrations-admin.service';

type Change = { clientId: string; registrationId: string };

@Injectable()
export class ChildApprovalRegistrationListener {
  constructor(
    private readonly admin: RegistrationsAdminService,
    private readonly repository: ChildApprovalRepository,
    private readonly policy: ChildApprovalPolicyService,
    private readonly removal: ChildApprovalRemovalService,
    private readonly faceSync: FaceSyncService,
  ) {}

  @OnEvent(CHILD_APPROVAL_ACCEPTED)
  async accepted({ clientId, registrationId }: Change) {
    const child = await this.repository.registration(clientId, registrationId);
    if (
      child?.childApprovalRequestedAt &&
      ['draft', 'rejected'].includes(child.status)
    ) {
      await this.admin.completeChildApproval(clientId, registrationId);
      return;
    }
    // Novo aceite após revogação/mudança de unidade de um cadastro já aprovado.
    if (
      child?.isActive &&
      ['approved', 'blocked'].includes(child.status) &&
      child.faceId != null &&
      (await this.policy.faceAllowed(clientId, child.faceId))
    ) {
      await this.faceSync.enqueueApprovedRegistrationJob(
        registrationId,
        clientId,
        undefined,
        { resetReaderProgress: true, blocked: child.status === 'blocked' },
      );
      await this.repository.clearApprovalIntent(clientId, registrationId);
    }
  }

  @OnEvent(CHILD_APPROVAL_CHANGED)
  changed({ clientId, registrationId }: Change) {
    return this.removal.enqueue(clientId, registrationId);
  }
}
