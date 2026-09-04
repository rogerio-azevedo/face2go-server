import { createZodDto } from 'nestjs-zod';

import {
  deviceSyncJobDtoSchema,
  enqueueDeviceSyncBodySchema,
} from '../device-sync-jobs.schema';

export class DeviceSyncJobDto extends createZodDto(deviceSyncJobDtoSchema) {}
export class EnqueueDeviceSyncBodyDto extends createZodDto(
  enqueueDeviceSyncBodySchema,
) {}
