import { createZodDto } from 'nestjs-zod';

import { clientAccessesListQuerySchema } from '../accesses.schema';

export class ClientAccessesListQueryDto extends createZodDto(
  clientAccessesListQuerySchema,
) {}
