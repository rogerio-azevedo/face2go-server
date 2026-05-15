import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { FacialAccess, FacialAccessSchema } from '../accesses/access.schema';
import { DatabaseModule } from '../database/database.module';
import { StorageModule } from '../storage/storage.module';
import { ResponsibleDashboardController } from './responsible-dashboard.controller';
import { ResponsibleDashboardService } from './responsible-dashboard.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FacialAccess.name, schema: FacialAccessSchema },
    ]),
    DatabaseModule,
    StorageModule,
  ],
  controllers: [ResponsibleDashboardController],
  providers: [ResponsibleDashboardService],
})
export class ResponsibleDashboardModule {}
