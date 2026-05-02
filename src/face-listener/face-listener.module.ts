import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { FaceListenerService } from './face-listener.service';

@Module({
  imports: [ConfigModule],
  providers: [FaceListenerService],
  exports: [FaceListenerService],
})
export class FaceListenerModule {}
