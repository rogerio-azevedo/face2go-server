import { Module } from '@nestjs/common';

import { LprListenerModule } from '../lpr-listener/lpr-listener.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { CamerasController } from './cameras.controller';
import { CamerasService } from './cameras.service';

@Module({
  imports: [PermissionsModule, LprListenerModule],
  controllers: [CamerasController],
  providers: [CamerasService],
})
export class CamerasModule {}
