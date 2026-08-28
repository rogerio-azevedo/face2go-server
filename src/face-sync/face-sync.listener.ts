import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { DatabaseService } from '../database/database.service';
import * as registrationsQueries from '../database/queries/registrations.queries';
import {
  FACE_SYNC_REQUESTED,
  type FaceSyncRequestedPayload,
} from './face-sync.events';
import { FaceSyncService } from './face-sync.service';

const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class FaceSyncListener implements OnModuleInit {
  private readonly log = new Logger(FaceSyncListener.name);
  private reconcileRunning = false;

  constructor(
    private readonly faceSync: FaceSyncService,
    private readonly database: DatabaseService,
  ) {}

  onModuleInit(): void {
    setInterval(() => {
      void this.reconcilePending();
    }, RECONCILE_INTERVAL_MS);
  }

  @OnEvent(FACE_SYNC_REQUESTED, { async: true })
  async handleFaceSyncRequested(payload: FaceSyncRequestedPayload): Promise<void> {
    try {
      const outcome = await this.faceSync.syncPersonOnReaders({
        clientId: payload.clientId,
        faceId: payload.faceId,
        name: payload.name,
        imageBuffer: payload.imageBuffer,
        photoKey: payload.photoKey,
        timeSectionIds: payload.timeSectionIds,
        logContext: payload.logContext,
        validFrom: payload.validFrom,
        validUntil: payload.validUntil,
        photoOnly: payload.photoOnly,
      });
      await payload.persistResult(outcome);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`face.sync.requested falhou: ${msg}`);
      try {
        await payload.persistResult({
          deviceSyncStatus: 'sync_failed',
          deviceSyncError: msg,
        });
      } catch (persistErr) {
        this.log.warn(
          `falha ao persistir sync_failed: ${persistErr instanceof Error ? persistErr.message : String(persistErr)}`,
        );
      }
    }
  }

  private async reconcilePending(): Promise<void> {
    if (this.reconcileRunning) return;
    this.reconcileRunning = true;
    try {
      const clientIds =
        await registrationsQueries.listClientIdsWithPendingDeviceSync(
          this.database.db,
        );
      for (const clientId of clientIds) {
        try {
          await this.faceSync.syncAllPending(clientId, () => undefined);
        } catch (err) {
          this.log.warn(
            `reconcile pending client=${clientId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      this.log.warn(
        `reconcile pending: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.reconcileRunning = false;
    }
  }
}
