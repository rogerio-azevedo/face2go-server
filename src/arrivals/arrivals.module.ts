import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { StorageModule } from '../storage/storage.module';

import { ArrivalsController } from './arrivals.controller';
import { ArrivalsListener } from './arrivals.listener';
import { ArrivalsService } from './arrivals.service';

@Module({
  imports: [DatabaseModule, StorageModule],
  controllers: [ArrivalsController],
  providers: [ArrivalsService, ArrivalsListener],
})
export class ArrivalsModule {}
