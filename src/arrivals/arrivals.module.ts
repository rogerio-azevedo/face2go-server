import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { FacialAccess, FacialAccessSchema } from '../accesses/access.schema';
import { DatabaseModule } from '../database/database.module';
import { StorageModule } from '../storage/storage.module';

import { ArrivalsController } from './arrivals.controller';
import { ArrivalsListener } from './arrivals.listener';
import { ArrivalsService } from './arrivals.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FacialAccess.name, schema: FacialAccessSchema },
    ]),
    DatabaseModule,
    StorageModule,
  ],
  controllers: [ArrivalsController],
  providers: [ArrivalsService, ArrivalsListener],
})
export class ArrivalsModule {}
