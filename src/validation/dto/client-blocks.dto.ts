import { createZodDto } from 'nestjs-zod';

import {
  createClientBlockSchema,
  createClientUnitSchema,
  generateClientUnitsSchema,
  mergeClientUnitSchema,
  updateClientBlockSchema,
  updateClientUnitSchema,
} from '../client-blocks.schema';

export class CreateClientBlockDto extends createZodDto(
  createClientBlockSchema,
) {}

export class UpdateClientBlockDto extends createZodDto(
  updateClientBlockSchema,
) {}

export class CreateClientUnitDto extends createZodDto(
  createClientUnitSchema,
) {}

export class GenerateClientUnitsDto extends createZodDto(
  generateClientUnitsSchema,
) {}

export class UpdateClientUnitDto extends createZodDto(
  updateClientUnitSchema,
) {}

export class MergeClientUnitDto extends createZodDto(mergeClientUnitSchema) {}
