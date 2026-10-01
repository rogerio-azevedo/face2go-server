import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { StorageModule } from '../storage/storage.module';
import { FaceMatchService } from './face-match.service';

@Module({
  imports: [DatabaseModule, StorageModule],
  providers: [FaceMatchService],
  exports: [FaceMatchService],
})
export class FaceMatchModule {}
