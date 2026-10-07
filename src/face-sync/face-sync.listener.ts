import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { calendarDateInOffset } from '../common/parse-access-list-datetime';
import { DatabaseService } from '../database/database.service';
import * as readersQueries from '../database/queries/readers.queries';
import * as registrationsQueries from '../database/queries/registrations.queries';
import { FaceSyncService } from './face-sync.service';

const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class FaceSyncListener implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(FaceSyncListener.name);
  private reconcileRunning = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly faceSync: FaceSyncService,
    private readonly database: DatabaseService,
  ) {}

  onModuleInit(): void {
    void this.reconcilePending();
    this.timer = setInterval(() => {
      void this.reconcilePending();
    }, RECONCILE_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
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
      await this.reconcileAgePolicies();
    } catch (err) {
      this.log.warn(
        `reconcile pending: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.reconcileRunning = false;
    }
  }

  private async reconcileAgePolicies(): Promise<void> {
    const now = new Date();
    const readers =
      await readersQueries.listAgeRestrictedReadersForReconciliation(
        this.database.db,
      );
    for (const reader of readers) {
      const today = calendarDateInOffset(reader.timezoneOffsetMinutes, now);
      const appliedOn = reader.agePolicyAppliedAt
        ? calendarDateInOffset(
            reader.timezoneOffsetMinutes,
            reader.agePolicyAppliedAt,
          )
        : null;
      if (reader.agePolicyStatus === 'applied' && appliedOn === today) {
        continue;
      }
      try {
        await this.faceSync.enqueueAgePolicyReconciliation(
          reader.clientId,
          reader.id,
          reader.agePolicyVersion,
        );
      } catch (err) {
        this.log.warn(
          `reconcile age policy reader=${reader.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
