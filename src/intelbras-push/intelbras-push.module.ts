import { Module } from '@nestjs/common';

import { AccessesModule } from '../accesses/accesses.module';
import { DatabaseModule } from '../database/database.module';
import { FaceListenerModule } from '../face-listener/face-listener.module';
import { IntelbrasPushController } from './intelbras-push.controller';
import { IntelbrasPushProvisionService } from './intelbras-push.provision.service';
import { IntelbrasPushReceiverService } from './intelbras-push.receiver.service';

@Module({
  imports: [DatabaseModule, AccessesModule, FaceListenerModule],
  controllers: [IntelbrasPushController],
  providers: [IntelbrasPushProvisionService, IntelbrasPushReceiverService],
  exports: [IntelbrasPushProvisionService, IntelbrasPushReceiverService],
})
export class IntelbrasPushModule {}
