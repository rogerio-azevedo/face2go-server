import { createZodDto } from 'nestjs-zod';

import {
  batchDeleteDeviceUsersSchema,
  createReaderSchema,
  removeDeviceUserOrphansSchema,
  updateReaderSchema,
} from '../readers.schema';

export class CreateReaderDto extends createZodDto(createReaderSchema) {}
export class PatchReaderDto extends createZodDto(updateReaderSchema) {}
export class BatchDeleteDeviceUsersDto extends createZodDto(
  batchDeleteDeviceUsersSchema,
) {}
export class RemoveDeviceUserOrphansDto extends createZodDto(
  removeDeviceUserOrphansSchema,
) {}
