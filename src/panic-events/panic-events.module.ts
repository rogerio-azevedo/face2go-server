import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { PermissionsModule } from '../permissions/permissions.module';
import { CompanyFeaturesModule } from '../company-features/company-features.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PanicEvent, PanicEventSchema } from './panic-event.schema';
import { PanicEventsController } from './panic-events.controller';
import { PanicEventsListener } from './panic-events.listener';
import { PanicEventsService } from './panic-events.service';

@Module({
  imports: [
    PermissionsModule,
    CompanyFeaturesModule,
    RealtimeModule,
    MongooseModule.forFeature([
      { name: PanicEvent.name, schema: PanicEventSchema },
    ]),
  ],
  controllers: [PanicEventsController],
  providers: [PanicEventsService, PanicEventsListener],
  exports: [PanicEventsService, PanicEventsListener],
})
export class PanicEventsModule {}
