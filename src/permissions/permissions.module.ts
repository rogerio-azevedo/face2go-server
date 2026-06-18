import { Module } from '@nestjs/common';

import { CompanyFeaturesModule } from '../company-features/company-features.module';
import { PermissionsService } from './permissions.service';

@Module({
  imports: [CompanyFeaturesModule],
  providers: [PermissionsService],
  exports: [PermissionsService],
})
export class PermissionsModule {}
