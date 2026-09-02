import { Module } from '@nestjs/common';

import { FaceListenerModule } from '../face-listener/face-listener.module';
import { IntelbrasPushModule } from '../intelbras-push/intelbras-push.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { ReadersController } from './readers.controller';
import { ReadersService } from './readers.service';

@Module({
  imports: [PermissionsModule, FaceListenerModule, IntelbrasPushModule],
  controllers: [ReadersController],
  providers: [ReadersService],
})
export class ReadersModule {}
