import { VisitorApprovalPolicyService } from '../visitor-approvals/visitor-approval-policy.service';
import { VisitorApprovalRepository } from '../visitor-approvals/visitor-approval.repository';
import { ConflictException, Injectable, Optional } from '@nestjs/common';
import {
  ChildApprovalRepository,
  type ApprovalDb,
} from './child-approval.repository';
import {
  needsChildApproval,
  CHILD_APPROVAL_PENDING_MESSAGE,
} from './child-approval.util';

export class ChildApprovalPendingError extends ConflictException {
  constructor() {
    super(CHILD_APPROVAL_PENDING_MESSAGE);
  }
}

@Injectable()
export class ChildApprovalPolicyService {
  constructor(
    private readonly repository: ChildApprovalRepository,
    @Optional() private readonly visitorPolicy?: VisitorApprovalPolicyService,
    @Optional() private readonly visitorRepository?: VisitorApprovalRepository,
  ) {}

  trackedFaces(clientId: string) {
    return Promise.all([
      this.repository.trackedFaces(clientId),
      this.visitorRepository?.trackedFaces(clientId) ?? [],
    ]).then((rows) => [...new Set(rows.flat())]);
  }

  async summary(clientId: string, registrationId: string) {
    const [client, registration, activeCount] = await Promise.all([
      this.repository.client(clientId),
      this.repository.registration(clientId, registrationId),
      this.repository.activeConsentCount(clientId, registrationId),
    ]);
    const required = Boolean(
      client && registration && needsChildApproval(client, registration),
    );
    return {
      enableChildApprove: client?.enableChildApprove ?? false,
      childApprovalRequired: registration?.childApprovalRequired ?? false,
      childApprovalStatus: !required
        ? ('not_applicable' as const)
        : activeCount > 0
          ? ('authorized' as const)
          : ('pending' as const),
      childApprovalValidCount: activeCount,
      childApprovalRequested: Boolean(registration?.childApprovalRequestedAt),
      childApprovalRemovalPending:
        registration?.childApprovalRemovalPending ?? false,
    };
  }

  async faceAllowed(clientId: string, faceId: number, db?: ApprovalDb) {
    if (
      this.visitorPolicy &&
      !(await this.visitorPolicy.faceAllowed(clientId, faceId, db))
    )
      return false;
    const rows = await this.repository.registrationByFace(clientId, faceId, db);
    for (const { client, registration } of rows) {
      if (
        (registration.childApprovalRemovalPending ||
          registration.visitorApprovalRemovalPending) &&
        (!registration.isActive || registration.status === 'rejected')
      )
        return false;
      if (!needsChildApproval(client, registration)) continue;
      if (
        !registration.isActive ||
        !['approved', 'blocked'].includes(registration.status) ||
        (await this.repository.activeConsentCount(
          clientId,
          registration.id,
          db,
        )) === 0
      )
        return false;
    }
    return true;
  }

  async removeIfUnauthorized(
    clientId: string,
    faceId: number,
    work: () => Promise<void>,
  ) {
    return this.repository.transaction(async (db) => {
      await this.repository.lockFace(db, clientId, faceId);
      if (await this.faceAllowed(clientId, faceId, db)) return false;
      await work();
      return true;
    });
  }

  async assertFaceAllowed(clientId: string, faceId: number) {
    if (!(await this.faceAllowed(clientId, faceId)))
      throw new ChildApprovalPendingError();
  }

  /** Serialize sync and consent changes across API/worker instances. */
  async withFaceAccess<T>(
    clientId: string,
    faceId: number,
    work: () => Promise<T>,
  ) {
    const rows = await this.repository.registrationByFace(clientId, faceId);
    if (
      !rows.some(
        ({ client, registration }) =>
          client.enableChildApprove ||
          client.enableVisitorApprove ||
          registration.childApprovalRequired ||
          registration.visitorApprovalRequired ||
          registration.childApprovalRemovalPending ||
          registration.visitorApprovalRemovalPending,
      )
    )
      return work();
    for (const { client, registration } of rows) {
      if (client.enableChildApprove && registration.childApprovalRequired)
        await this.repository.rememberFaces(clientId, registration.id);
    }
    for (const { client, registration } of rows) {
      if (client.enableVisitorApprove && registration.visitorApprovalRequired)
        await this.visitorRepository?.rememberFaces(clientId, registration.id);
    }
    return this.repository.transaction(async (db) => {
      await this.repository.lockFace(db, clientId, faceId);
      if (!(await this.faceAllowed(clientId, faceId, db)))
        throw new ChildApprovalPendingError();
      return work();
    });
  }
}
