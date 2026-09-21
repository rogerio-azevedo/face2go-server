import { createZodDto } from 'nestjs-zod';

import {
  clientAccessesListQuerySchema,
  companyAccessesListQuerySchema,
} from '../accesses.schema';

export class ClientAccessesListQueryDto extends createZodDto(
  clientAccessesListQuerySchema,
) {}

export class CompanyAccessesListQueryDto extends createZodDto(
  companyAccessesListQuerySchema,
) {}
