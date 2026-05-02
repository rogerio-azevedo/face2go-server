import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { StorageModule } from '../storage/storage.module';
import {
  ClientFaceSyncController,
  CompanyFaceSyncController,
} from './face-sync.controller';
import { FaceSyncService } from './face-sync.service';

@Module({
  imports: [DatabaseModule, PermissionsModule, StorageModule],
  controllers: [CompanyFaceSyncController, ClientFaceSyncController],
  providers: [FaceSyncService],
  exports: [FaceSyncService],
})
export class FaceSyncModule {}
