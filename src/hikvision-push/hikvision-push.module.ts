import { Module } from '@nestjs/common';

import { AccessesModule } from '../accesses/accesses.module';
import { DatabaseModule } from '../database/database.module';
import { FaceListenerModule } from '../face-listener/face-listener.module';
import { HikvisionPushController } from './hikvision-push.controller';
import { HikvisionPushReceiverService } from './hikvision-push.receiver.service';

@Module({
  imports: [DatabaseModule, AccessesModule, FaceListenerModule],
  controllers: [HikvisionPushController],
  providers: [HikvisionPushReceiverService],
})
export class HikvisionPushModule {}
