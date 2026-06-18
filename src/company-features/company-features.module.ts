import { Module } from '@nestjs/common';

import { CompanyFeaturesController } from './company-features.controller';
import { CompanyFeaturesService } from './company-features.service';

@Module({
  controllers: [CompanyFeaturesController],
  providers: [CompanyFeaturesService],
  exports: [CompanyFeaturesService],
})
export class CompanyFeaturesModule {}
