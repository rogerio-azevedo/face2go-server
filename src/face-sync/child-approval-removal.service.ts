import { VisitorApprovalRepository } from '../visitor-approvals/visitor-approval.repository';
import { Injectable, Optional } from '@nestjs/common';
import { ChildApprovalRepository } from '../child-approvals/child-approval.repository';
import { ChildApprovalPolicyService } from '../child-approvals/child-approval-policy.service';
import type { DeviceSyncJobRow } from '../database/schema/device-sync-jobs';
import { DeviceSyncQueueService } from '../device-sync-queue/device-sync-queue.service';
import { FaceSyncService } from './face-sync.service';

@Injectable()
export class ChildApprovalRemovalService {
  constructor(
    private readonly repository: ChildApprovalRepository,
    private readonly policy: ChildApprovalPolicyService,
    private readonly queue: DeviceSyncQueueService,
    private readonly faceSync: FaceSyncService,
    @Optional() private readonly visitors?: VisitorApprovalRepository,
  ) {}

  async enqueue(clientId: string, registrationId: string) {
    const child = await this.repository.registration(clientId, registrationId);
    if (!(
      child?.childApprovalRemovalPending || child?.visitorApprovalRemovalPending
    ))
      return;
    await this.queue.enqueue({
      kind: 'face.remove',
      clientId,
      targetId: registrationId,
      dedupeKey: `face.remove:${clientId}:${registrationId}`,
      payload: {},
      total: 1,
    });
  }

  async run(job: DeviceSyncJobRow) {
    await this.repository.transaction(async (db) => {
      const locked = await this.repository.registration(
        job.clientId,
        job.targetId,
        db,
        true,
      );
      if (!(
        locked?.childApprovalRemovalPending ||
        locked?.visitorApprovalRemovalPending
      ))
        return;
      const faces = await this.repository.faceIds(
        job.clientId,
        job.targetId,
        db,
      );
      if (this.visitors)
        for (const id of await this.visitors.faceIds(
          job.clientId,
          job.targetId,
          db,
        ))
          if (!faces.includes(id)) faces.push(id);
      faces.sort((a, b) => a - b);
      for (const faceId of faces)
        await this.repository.lockFace(db, job.clientId, faceId);
      const child = await this.repository.registration(
        job.clientId,
        job.targetId,
        db,
      );
      if (!(
        child?.childApprovalRemovalPending ||
        child?.visitorApprovalRemovalPending
      ))
        return;
      let removed = false;
      for (const faceId of faces) {
        // Outro adulto ainda pode autorizar; nunca remover um acesso válido.
        if (await this.policy.faceAllowed(job.clientId, faceId, db)) continue;
        const result = await this.faceSync.removePersonFromReaders({
          clientId: job.clientId,
          faceId,
          requireAll: true,
          logContext: `child-approval=${job.targetId}`,
        });
        if (
          result.total <
          (await this.repository.activeReaderCount(job.clientId, db))
        )
          throw new Error(
            'Há leitores ativos sem credenciais para concluir a remoção.',
          );
        removed = true;
      }
      await this.repository.patchRegistration(
        job.clientId,
        job.targetId,
        {
          childApprovalRemovalPending: false,
          visitorApprovalRemovalPending: false,
          ...(removed
            ? {
                deviceSyncStatus: null,
                deviceSyncError: null,
                deviceSyncedAt: null,
              }
            : {}),
        },
        db,
      );
      if (removed)
        await this.repository.clearMemberSync(job.clientId, job.targetId, db);
    });
    await this.queue.update(job.id, { processed: 1, total: 1 });
  }
}
