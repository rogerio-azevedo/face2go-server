import { Module } from '@nestjs/common';

import { CompanyFeaturesModule } from '../company-features/company-features.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { MeController } from './me.controller';

@Module({
  imports: [PermissionsModule, CompanyFeaturesModule],
  controllers: [MeController],
})
export class MeModule {}
