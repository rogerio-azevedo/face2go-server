import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { LprAccessesModule } from '../lpr-accesses/lpr-accesses.module';
import { LprListenerService } from './lpr-listener.service';

@Module({
  imports: [ConfigModule, LprAccessesModule],
  providers: [LprListenerService],
  exports: [LprListenerService],
})
export class LprListenerModule {}
