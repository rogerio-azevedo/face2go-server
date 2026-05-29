import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { FaceSyncModule } from '../face-sync/face-sync.module';
import { LprPlateSyncModule } from '../lpr-plate-sync/lpr-plate-sync.module';
import { SchoolAccessModule } from '../school-access/school-access.module';
import { StorageModule } from '../storage/storage.module';
import {
  PickupAuthorizationsResponsibleController,
  PickupAuthorizationsSchoolController,
} from './pickup-authorizations.controller';
import { PickupAuthorizationsService } from './pickup-authorizations.service';
import { PublicPickupRegisterController } from './public-pickup-register.controller';
import { PublicPickupRegisterService } from './public-pickup-register.service';

@Module({
  imports: [
    DatabaseModule,
    SchoolAccessModule,
    StorageModule,
    FaceSyncModule,
    LprPlateSyncModule,
  ],
  controllers: [
    PickupAuthorizationsSchoolController,
    PickupAuthorizationsResponsibleController,
    PublicPickupRegisterController,
  ],
  providers: [PickupAuthorizationsService, PublicPickupRegisterService],
  exports: [PickupAuthorizationsService],
})
export class PickupAuthorizationsModule {}
