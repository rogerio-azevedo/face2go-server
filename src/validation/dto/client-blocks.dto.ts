import { createZodDto } from 'nestjs-zod';

import {
  bindLocationGroupsSchema,
  createClientBlockSchema,
  ensureLocationUnitSchema,
  createClientUnitSchema,
  generateClientUnitsSchema,
  generateStructureSchema,
  updateClientBlockSchema,
  updateClientUnitSchema,
} from '../client-blocks.schema';

export class CreateClientBlockDto extends createZodDto(
  createClientBlockSchema,
) {}

export class UpdateClientBlockDto extends createZodDto(
  updateClientBlockSchema,
) {}

export class CreateClientUnitDto extends createZodDto(createClientUnitSchema) {}

export class GenerateClientUnitsDto extends createZodDto(
  generateClientUnitsSchema,
) {}

export class UpdateClientUnitDto extends createZodDto(updateClientUnitSchema) {}

export class GenerateStructureDto extends createZodDto(
  generateStructureSchema,
) {}

export class EnsureLocationUnitDto extends createZodDto(
  ensureLocationUnitSchema,
) {}

export class BindLocationGroupsDto extends createZodDto(
  bindLocationGroupsSchema,
) {}
