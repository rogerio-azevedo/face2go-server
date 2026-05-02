import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AccessesModule } from '../accesses/accesses.module';
import { FaceListenerService } from './face-listener.service';

@Module({
  imports: [ConfigModule, AccessesModule],
  providers: [FaceListenerService],
  exports: [FaceListenerService],
})
export class FaceListenerModule {}
