import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { SchoolAccessModule } from '../school-access/school-access.module';
import {
  PickupAuthorizationsResponsibleController,
  PickupAuthorizationsSchoolController,
} from './pickup-authorizations.controller';
import { PickupAuthorizationsService } from './pickup-authorizations.service';

@Module({
  imports: [DatabaseModule, SchoolAccessModule],
  controllers: [
    PickupAuthorizationsSchoolController,
    PickupAuthorizationsResponsibleController,
  ],
  providers: [PickupAuthorizationsService],
  exports: [PickupAuthorizationsService],
})
export class PickupAuthorizationsModule {}
