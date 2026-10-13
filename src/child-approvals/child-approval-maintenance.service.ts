import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ChildApprovalRepository } from './child-approval.repository';
import { ChildApprovalService } from './child-approval.service';
import { ChildApprovalDeliveryService } from './child-approval-delivery.service';
import {
  CHILD_APPROVAL_ACCEPTED,
  CHILD_APPROVAL_CHANGED,
  needsChildApproval,
} from './child-approval.util';

@Injectable()
export class ChildApprovalMaintenanceService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ChildApprovalMaintenanceService.name);
  private timer?: NodeJS.Timeout;
  private busy = false;
  constructor(
    private readonly repository: ChildApprovalRepository,
    private readonly approvals: ChildApprovalService,
    private readonly delivery: ChildApprovalDeliveryService,
  ) {}

  onModuleInit() {
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
        for (const { registration: child, client } of cases) {
          for (const consent of await this.repository.history(
            client.id,
            child.id,
          )) {
            if (consent.revokedAt) continue;
            const adult = await this.repository.registration(
              client.id,
              consent.adultRegistrationId,
            );
            if (
              child.unitId !== consent.unitId ||
              adult?.unitId !== consent.unitId ||
              !adult?.isActive ||
              adult.status !== 'approved'
            ) {
              await this.repository.transaction(async (db) => {
                const freshChild = await this.repository.registration(
                  client.id,
                  child.id,
                  db,
                  true,
                );
                const freshAdult = await this.repository.registration(
                  client.id,
                  consent.adultRegistrationId,
                  db,
                );
                if (
                  freshChild?.unitId === consent.unitId &&
                  freshAdult?.unitId === consent.unitId &&
                  freshAdult?.isActive &&
                  freshAdult.status === 'approved'
                )
                  return;
                for (const faceId of await this.repository.faceIds(
                  client.id,
                  child.id,
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
                  child.id,
                  { childApprovalRemovalPending: true },
                  db,
                );
              });
            }
          }
          const count = await this.repository.activeConsentCount(
            client.id,
            child.id,
          );
          if (
            child.childApprovalRequestedAt &&
            (count > 0 || !needsChildApproval(client, child))
          )
            await this.approvals.notify(
              CHILD_APPROVAL_ACCEPTED,
              client.id,
              child.id,
            );
          if (
            count === 0 &&
            needsChildApproval(client, child) &&
            ['approved', 'blocked'].includes(child.status) &&
            child.deviceSyncStatus != null
          ) {
            await this.repository.patchRegistration(client.id, child.id, {
              childApprovalRemovalPending: true,
            });
          }
          const fresh = await this.repository.registration(client.id, child.id);
          if (fresh?.childApprovalRemovalPending)
            await this.approvals.notify(
              CHILD_APPROVAL_CHANGED,
              client.id,
              child.id,
            );
          if (count === 0 && needsChildApproval(client, child))
            await this.approvals.requestEmails(client.id, child.id);
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
