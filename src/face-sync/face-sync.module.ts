import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { SchoolAccessModule } from '../school-access/school-access.module';
import { StorageModule } from '../storage/storage.module';
import {
  ClientFaceSyncController,
  CompanyFaceSyncController,
} from './face-sync.controller';
import { AccessTimeZoneService } from './access-time-zone.service';
import { FaceSyncService } from './face-sync.service';
import { GlobalFaceSyncService } from './global-face-sync.service';
import { FaceSyncListener } from './face-sync.listener';

@Module({
  imports: [
    DatabaseModule,
    PermissionsModule,
    StorageModule,
    SchoolAccessModule,
  ],
  controllers: [CompanyFaceSyncController, ClientFaceSyncController],
  providers: [
    FaceSyncService,
    AccessTimeZoneService,
    GlobalFaceSyncService,
    FaceSyncListener,
  ],
  exports: [FaceSyncService, AccessTimeZoneService, GlobalFaceSyncService],
})
export class FaceSyncModule {}
