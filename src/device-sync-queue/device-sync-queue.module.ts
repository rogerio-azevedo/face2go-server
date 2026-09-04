import { Global, Module } from '@nestjs/common';

import { DeviceSyncJobsController } from './device-sync-jobs.controller';
import { DeviceSyncPersistService } from './device-sync-persist.service';
import { DeviceSyncQueueService } from './device-sync-queue.service';

@Global()
@Module({
  controllers: [DeviceSyncJobsController],
  providers: [DeviceSyncQueueService, DeviceSyncPersistService],
  exports: [DeviceSyncQueueService, DeviceSyncPersistService],
})
export class DeviceSyncQueueModule {}
