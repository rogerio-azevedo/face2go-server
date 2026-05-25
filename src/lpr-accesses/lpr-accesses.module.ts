import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { StorageModule } from '../storage/storage.module';
import { LprAccess, LprAccessSchema } from './lpr-access.schema';
import { LprAccessesService } from './lpr-accesses.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LprAccess.name, schema: LprAccessSchema },
    ]),
    StorageModule,
  ],
  providers: [LprAccessesService],
  exports: [LprAccessesService],
})
export class LprAccessesModule {}
