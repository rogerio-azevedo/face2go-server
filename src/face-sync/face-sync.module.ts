import { ChildApprovalPolicyModule } from '../child-approvals/child-approval-policy.module';
import { ChildApprovalRemovalService } from './child-approval-removal.service';
import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { DeviceSyncQueueModule } from '../device-sync-queue/device-sync-queue.module';
import { DeviceSyncJobHandlersService } from '../device-sync-queue/device-sync-job-handlers.service';
import { DeviceSyncWorkerService } from '../device-sync-queue/device-sync-worker.service';
import { LprPlateSyncModule } from '../lpr-plate-sync/lpr-plate-sync.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { SchoolAccessModule } from '../school-access/school-access.module';
import { FaceMatchModule } from '../face-match/face-match.module';
import { StorageModule } from '../storage/storage.module';
import {
  ClientFaceSyncController,
  CompanyFaceSyncController,
} from './face-sync.controller';
import { AccessTimeZoneService } from './access-time-zone.service';
import { FaceReaderRebuildService } from './face-reader-rebuild.service';
import { FaceSyncService } from './face-sync.service';
import { FaceSyncListener } from './face-sync.listener';

@Module({
  imports: [
    DatabaseModule,
    ChildApprovalPolicyModule,
    PermissionsModule,
    StorageModule,
    FaceMatchModule,
    SchoolAccessModule,
    DeviceSyncQueueModule,
    LprPlateSyncModule,
  ],
  controllers: [CompanyFaceSyncController, ClientFaceSyncController],
  providers: [
    FaceSyncService,
    ChildApprovalRemovalService,
    AccessTimeZoneService,
    FaceReaderRebuildService,
    FaceSyncListener,
    DeviceSyncJobHandlersService,
    DeviceSyncWorkerService,
  ],
  exports: [
    ChildApprovalRemovalService,
    FaceSyncService,
    AccessTimeZoneService,
    FaceReaderRebuildService,
  ],
})
export class FaceSyncModule {}
