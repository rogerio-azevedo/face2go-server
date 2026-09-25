import { Global, Module } from '@nestjs/common';

import { ClientDeviceSyncJobsController } from './client-device-sync-jobs.controller';
import { DeviceSyncAdminService } from './device-sync-admin.service';
import { DeviceSyncJobsController } from './device-sync-jobs.controller';
import { DeviceSyncPersistService } from './device-sync-persist.service';
import { DeviceSyncQueueService } from './device-sync-queue.service';

@Global()
@Module({
  controllers: [DeviceSyncJobsController, ClientDeviceSyncJobsController],
  providers: [
    DeviceSyncQueueService,
    DeviceSyncPersistService,
    DeviceSyncAdminService,
  ],
  exports: [DeviceSyncQueueService, DeviceSyncPersistService],
})
export class DeviceSyncQueueModule {}
