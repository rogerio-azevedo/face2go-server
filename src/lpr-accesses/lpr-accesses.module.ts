import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { DatabaseModule } from '../database/database.module';
import { StorageModule } from '../storage/storage.module';
import { LprAccess, LprAccessSchema } from './lpr-access.schema';
import { LprAccessesController } from './lpr-accesses.controller';
import { LprAccessesService } from './lpr-accesses.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LprAccess.name, schema: LprAccessSchema },
    ]),
    DatabaseModule,
    StorageModule,
  ],
  controllers: [LprAccessesController],
  providers: [LprAccessesService],
  exports: [LprAccessesService],
})
export class LprAccessesModule {}
