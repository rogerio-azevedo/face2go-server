import { createZodDto } from 'nestjs-zod';

import {
  createResponsibleSchema,
  updateResponsibleSchema,
} from '../responsibles.schema';

export class CreateResponsibleDto extends createZodDto(
  createResponsibleSchema,
) {}
export class PatchResponsibleDto extends createZodDto(
  updateResponsibleSchema,
) {}
