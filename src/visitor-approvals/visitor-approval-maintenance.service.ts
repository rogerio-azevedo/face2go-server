import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { VisitorApprovalRepository } from './visitor-approval.repository';
import { VisitorApprovalService } from './visitor-approval.service';
import { VisitorApprovalDeliveryService } from './visitor-approval-delivery.service';
import { VisitorApprovalRevocationService } from './visitor-approval-revocation.service';
import {
  VISITOR_APPROVAL_ACCEPTED,
  VISITOR_APPROVAL_CHANGED,
  needsVisitorApproval,
} from './visitor-approval.util';

@Injectable()
export class VisitorApprovalMaintenanceService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(VisitorApprovalMaintenanceService.name);
  private timer?: NodeJS.Timeout;
  private busy = false;
  constructor(
    private readonly repository: VisitorApprovalRepository,
    private readonly approvals: VisitorApprovalService,
    private readonly delivery: VisitorApprovalDeliveryService,
    private readonly revocations: VisitorApprovalRevocationService,
  ) {}

  onModuleInit() {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let offset = 0; ; offset += 100) {
        const cases = await this.repository.pendingCases(100, offset);
        for (const { registration: visitor, client } of cases) {
          for (const consent of await this.repository.history(
            client.id,
            visitor.id,
          )) {
            if (consent.revokedAt) continue;
            const adult = await this.repository.registration(
              client.id,
              consent.adultRegistrationId,
            );
            if (
              visitor.unitId !== consent.unitId ||
              adult?.unitId !== consent.unitId ||
              !adult?.isActive ||
              adult.isVisitor ||
              adult.status !== 'approved'
            ) {
              await this.repository.transaction(async (db) => {
                const freshVisitor = await this.repository.registration(
                  client.id,
                  visitor.id,
                  db,
                  true,
                );
                const freshAdult = await this.repository.registration(
                  client.id,
                  consent.adultRegistrationId,
                  db,
                );
                if (
                  freshVisitor?.unitId === consent.unitId &&
                  freshAdult?.unitId === consent.unitId &&
                  freshAdult?.isActive &&
                  freshAdult.status === 'approved' &&
                  !freshAdult.isVisitor
                )
                  return;
                for (const faceId of await this.repository.faceIds(
                  client.id,
                  visitor.id,
                  db,
                ))
                  await this.repository.lockFace(db, client.id, faceId);
                await this.repository.revoke(
                  client.id,
                  consent.id,
                  'system',
                  'Unidade alterada ou cadastro do autorizador indisponível.',
                  db,
                );
                await this.repository.patchRegistration(
                  client.id,
                  visitor.id,
                  { visitorApprovalRemovalPending: true },
                  db,
                );
              });
            }
          }
          const count = await this.repository.activeConsentCount(
            client.id,
            visitor.id,
          );
          if (
            client.isActive &&
            visitor.isActive &&
            visitor.visitorApprovalRequestedAt &&
            (count > 0 || !needsVisitorApproval(client, visitor))
          )
            await this.approvals.notify(
              VISITOR_APPROVAL_ACCEPTED,
              client.id,
              visitor.id,
            );
          if (
            count === 0 &&
            needsVisitorApproval(client, visitor) &&
            ['approved', 'blocked'].includes(visitor.status)
          ) {
            await this.repository.transaction((db) =>
              this.revocations.rejectIfUnauthorized(db, client.id, visitor.id),
            );
          }
          const fresh = await this.repository.registration(
            client.id,
            visitor.id,
          );
          if (fresh?.visitorApprovalRemovalPending)
            await this.approvals.notify(
              VISITOR_APPROVAL_CHANGED,
              client.id,
              visitor.id,
            );
          if (
            client.isActive &&
            visitor.isActive &&
            count === 0 &&
            needsVisitorApproval(client, visitor)
          )
            await this.approvals.requestEmails(client.id, visitor.id);
        }
        if (cases.length < 100) break;
      }
      await this.delivery.dispatch();
    } catch {
      this.logger.warn('Reconciliação de autorizações será tentada novamente.');
    } finally {
      this.busy = false;
    }
  }
}
