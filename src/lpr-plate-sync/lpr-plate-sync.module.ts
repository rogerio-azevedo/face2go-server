import { Global, Module } from '@nestjs/common';

import { PermissionsModule } from '../permissions/permissions.module';
import {
  ClientLprPlateSyncController,
  CompanyLprPlateSyncController,
} from './lpr-plate-sync.controller';
import { LprPlateSyncService } from './lpr-plate-sync.service';

@Global()
@Module({
  imports: [PermissionsModule],
  controllers: [
    CompanyLprPlateSyncController,
    ClientLprPlateSyncController,
  ],
  providers: [LprPlateSyncService],
  exports: [LprPlateSyncService],
})
export class LprPlateSyncModule {}
