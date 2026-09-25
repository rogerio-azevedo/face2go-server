import { createZodDto } from 'nestjs-zod';

import {
  deviceSyncCancelQueuedResultSchema,
  deviceSyncJobCancelResultSchema,
  deviceSyncJobDtoSchema,
  deviceSyncJobListSchema,
  deviceSyncJobSummarySchema,
  enqueueDeviceSyncBodySchema,
  listDeviceSyncJobsQuerySchema,
} from '../device-sync-jobs.schema';

export class DeviceSyncJobDto extends createZodDto(deviceSyncJobDtoSchema) {}
export class EnqueueDeviceSyncBodyDto extends createZodDto(
  enqueueDeviceSyncBodySchema,
) {}
export class ListDeviceSyncJobsQueryDto extends createZodDto(
  listDeviceSyncJobsQuerySchema,
) {}
export class DeviceSyncJobListDto extends createZodDto(
  deviceSyncJobListSchema,
) {}
export class DeviceSyncJobSummaryDto extends createZodDto(
  deviceSyncJobSummarySchema,
) {}
export class DeviceSyncJobCancelResultDto extends createZodDto(
  deviceSyncJobCancelResultSchema,
) {}
export class DeviceSyncCancelQueuedResultDto extends createZodDto(
  deviceSyncCancelQueuedResultSchema,
) {}
