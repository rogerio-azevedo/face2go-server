import { Module } from '@nestjs/common';

import { AccessesModule } from '../accesses/accesses.module';
import { FaceListenerModule } from '../face-listener/face-listener.module';
import { FaceSyncModule } from '../face-sync/face-sync.module';
import { IntelbrasPushModule } from '../intelbras-push/intelbras-push.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { StorageModule } from '../storage/storage.module';
import { ClientReadersController } from './client-readers.controller';
import { ReadersController } from './readers.controller';
import { ReadersDeviceUsersController } from './readers-device-users.controller';
import { ReadersDeviceUsersService } from './readers-device-users.service';
import { ReadersDeviceWipeSyncService } from './readers-device-wipe-sync.service';
import { ReadersCredentialsService } from './readers-credentials.service';
import { ReadersRemoteOpenService } from './readers-remote-open.service';
import { ReadersService } from './readers.service';

@Module({
  imports: [
    PermissionsModule,
    FaceListenerModule,
    IntelbrasPushModule,
    FaceSyncModule,
    StorageModule,
    AccessesModule,
  ],
  controllers: [
    ReadersController,
    ClientReadersController,
    ReadersDeviceUsersController,
  ],
  providers: [
    ReadersService,
    ReadersDeviceUsersService,
    ReadersDeviceWipeSyncService,
    ReadersRemoteOpenService,
    ReadersCredentialsService,
  ],
})
export class ReadersModule {}
