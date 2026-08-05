import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CompanyFeaturesModule } from '../company-features/company-features.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { EmergencyEventsController } from './emergency-events.controller';
import { EmergencyEventsService } from './emergency-events.service';
import { EmergencyGateway } from './emergency.gateway';

@Module({
  imports: [AuthModule, PermissionsModule, CompanyFeaturesModule],
  controllers: [EmergencyEventsController],
  providers: [EmergencyEventsService, EmergencyGateway],
  exports: [EmergencyEventsService, EmergencyGateway],
})
export class EmergencyEventsModule {}
