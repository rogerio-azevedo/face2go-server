import { Module } from '@nestjs/common';

import { CompanyFeaturesModule } from '../company-features/company-features.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { PresenceController } from './presence.controller';
import { PresenceListener } from './presence.listener';
import { PresenceService } from './presence.service';

@Module({
  imports: [PermissionsModule, CompanyFeaturesModule],
  controllers: [PresenceController],
  providers: [PresenceService, PresenceListener],
  exports: [PresenceService],
})
export class PresenceModule {}
