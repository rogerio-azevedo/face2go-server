import { createZodDto } from 'nestjs-zod';

import { setIenhFilialMappingSchema } from '../ienh.schema';

export class SetIenhFilialMappingDto extends createZodDto(
  setIenhFilialMappingSchema,
) {}
