import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { FaceSyncModule } from '../face-sync/face-sync.module';
import { LprPlateSyncModule } from '../lpr-plate-sync/lpr-plate-sync.module';
import { PeopleModule } from '../people/people.module';
import { ResponsiblesController } from './responsibles.controller';
import { ResponsiblesService } from './responsibles.service';
import { SchoolAccessModule } from '../school-access/school-access.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    DatabaseModule,
    SchoolAccessModule,
    StorageModule,
    FaceSyncModule,
    LprPlateSyncModule,
    PeopleModule,
  ],
  controllers: [ResponsiblesController],
  providers: [ResponsiblesService],
  exports: [ResponsiblesService],
})
export class ResponsiblesModule {}
