import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { DeviceSyncQueueModule } from '../device-sync-queue/device-sync-queue.module';
import { DeviceSyncWorkerService } from '../device-sync-queue/device-sync-worker.service';
import { PermissionsModule } from '../permissions/permissions.module';
import { SchoolAccessModule } from '../school-access/school-access.module';
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
    PermissionsModule,
    StorageModule,
    SchoolAccessModule,
    DeviceSyncQueueModule,
  ],
  controllers: [CompanyFaceSyncController, ClientFaceSyncController],
  providers: [
    FaceSyncService,
    AccessTimeZoneService,
    FaceReaderRebuildService,
    FaceSyncListener,
    DeviceSyncWorkerService,
  ],
  exports: [
    FaceSyncService,
    AccessTimeZoneService,
    FaceReaderRebuildService,
  ],
})
export class FaceSyncModule {}
