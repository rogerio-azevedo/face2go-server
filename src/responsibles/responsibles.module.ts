import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { ResponsiblesController } from './responsibles.controller';
import { ResponsiblesService } from './responsibles.service';
import { SchoolAccessModule } from '../school-access/school-access.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [DatabaseModule, SchoolAccessModule, StorageModule],
  controllers: [ResponsiblesController],
  providers: [ResponsiblesService],
  exports: [ResponsiblesService],
})
export class ResponsiblesModule {}
