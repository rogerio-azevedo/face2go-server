import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { FacialAccess, FacialAccessSchema } from '../accesses/access.schema';
import { DatabaseModule } from '../database/database.module';
import { StorageModule } from '../storage/storage.module';

import { SimulateController } from './simulate.controller';
import { SimulateService } from './simulate.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FacialAccess.name, schema: FacialAccessSchema },
    ]),
    DatabaseModule,
    StorageModule,
  ],
  controllers: [SimulateController],
  providers: [SimulateService],
})
export class SimulateModule {}
