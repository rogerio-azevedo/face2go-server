import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { FacialAccess, FacialAccessSchema } from '../accesses/access.schema';
import { StorageModule } from '../storage/storage.module';
import { AlertsService } from './alerts.service';
import { ClientAlertsController } from './client-alerts.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FacialAccess.name, schema: FacialAccessSchema },
    ]),
    StorageModule,
  ],
  controllers: [ClientAlertsController],
  providers: [AlertsService],
})
export class AlertsModule {}
