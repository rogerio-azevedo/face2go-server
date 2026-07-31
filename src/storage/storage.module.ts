import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { R2StorageService } from './r2-storage.service';

@Module({
  imports: [ConfigModule],
  providers: [R2StorageService],
  exports: [R2StorageService],
})
export class StorageModule {}
