import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import * as registrationsQueries from '../database/queries/registrations.queries';
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
          const rows =
            await registrationsQueries.listApprovedRegistrationsPendingDeviceSync(
              this.database.db,
              clientId,
            );
          for (const row of rows) {
            await this.faceSync.enqueueApprovedRegistrationJob(
              row.id,
              clientId,
            );
          }
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
