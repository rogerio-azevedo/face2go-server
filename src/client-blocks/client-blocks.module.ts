import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { ClientBlocksController } from './client-blocks.controller';
import { ClientBlocksRepository } from './client-blocks.repository';
import { ClientBlocksService } from './client-blocks.service';
import { CondominiumAccessService } from './condominium-access.service';
import { LocationReviewController } from './location-review.controller';
import { LocationReviewRepository } from './location-review.repository';
import { LocationReviewService } from './location-review.service';

@Module({
  imports: [DatabaseModule, PermissionsModule],
  controllers: [ClientBlocksController, LocationReviewController],
  providers: [
    ClientBlocksRepository,
    ClientBlocksService,
    CondominiumAccessService,
    LocationReviewRepository,
    LocationReviewService,
  ],
  exports: [ClientBlocksRepository],
})
export class ClientBlocksModule {}
