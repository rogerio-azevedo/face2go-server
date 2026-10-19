import { isValidCpf } from '../common/utils/document';
import { Injectable } from '@nestjs/common';
import {
  VisitorApprovalRepository,
  type ApprovalDb,
} from './visitor-approval.repository';
import { needsVisitorApproval, ageForApproval } from './visitor-approval.util';

@Injectable()
export class VisitorApprovalPolicyService {
  constructor(private readonly repository: VisitorApprovalRepository) {}

  trackedFaces(clientId: string) {
    return this.repository.trackedFaces(clientId);
  }

  async summary(clientId: string, registrationId: string) {
    const [client, registration, activeCount] = await Promise.all([
      this.repository.client(clientId),
      this.repository.registration(clientId, registrationId),
      this.repository.activeConsentCount(clientId, registrationId),
    ]);
    const required = Boolean(
      client && registration && needsVisitorApproval(client, registration),
    );
    const eligibleAdults =
      required && registration?.unitId
        ? (
            await this.repository.adultsInUnit(clientId, registration.unitId)
          ).filter(
            (a) =>
              a.id !== registration.id &&
              (ageForApproval(a.birthDate, client.timezoneOffsetMinutes) ??
                -1) >= 18 &&
              a.document &&
              isValidCpf(a.document) &&
              a.email,
          )
        : [];
    return {
      visitorApprovalPendingReason:
        !required || activeCount > 0
          ? null
          : eligibleAdults.length === 0
            ? ('no_eligible_adult' as const)
            : ('awaiting_consent' as const),
      isVisitor: registration?.isVisitor ?? false,
      enableVisitorApprove: client?.enableVisitorApprove ?? false,
      visitorApprovalRequired: registration?.visitorApprovalRequired ?? false,
      visitorApprovalStatus: !required
        ? ('not_applicable' as const)
        : activeCount > 0
          ? ('authorized' as const)
          : ('pending' as const),
      visitorApprovalValidCount: activeCount,
      visitorApprovalRequested: Boolean(
        registration?.visitorApprovalRequestedAt,
      ),
      visitorApprovalRemovalPending:
        registration?.visitorApprovalRemovalPending ?? false,
    };
  }

  async faceAllowed(clientId: string, faceId: number, db?: ApprovalDb) {
    const rows = await this.repository.registrationByFace(clientId, faceId, db);
    for (const { client, registration } of rows) {
      if (
        (registration.childApprovalRemovalPending ||
          registration.visitorApprovalRemovalPending) &&
        (!registration.isActive || registration.status === 'rejected')
      )
        return false;
      if (!needsVisitorApproval(client, registration)) continue;
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
}
