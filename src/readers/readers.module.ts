import { Module } from '@nestjs/common';

import { FaceListenerModule } from '../face-listener/face-listener.module';
import { FaceSyncModule } from '../face-sync/face-sync.module';
import { IntelbrasPushModule } from '../intelbras-push/intelbras-push.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { StorageModule } from '../storage/storage.module';
import { ReadersController } from './readers.controller';
import { ReadersDeviceUsersController } from './readers-device-users.controller';
import { ReadersDeviceUsersService } from './readers-device-users.service';
import { ReadersDeviceWipeSyncService } from './readers-device-wipe-sync.service';
import { ReadersService } from './readers.service';

@Module({
  imports: [
    PermissionsModule,
    FaceListenerModule,
    IntelbrasPushModule,
    FaceSyncModule,
    StorageModule,
  ],
  controllers: [ReadersController, ReadersDeviceUsersController],
  providers: [
    ReadersService,
    ReadersDeviceUsersService,
    ReadersDeviceWipeSyncService,
  ],
})
export class ReadersModule {}
