import { createZodDto } from 'nestjs-zod';

import { createCompanySchema, updateCompanySchema } from '../companies.schema';
import { generateInviteSchema } from '../invites.schema';

export class CreateCompanyDto extends createZodDto(createCompanySchema) {}
export class PatchCompanyDto extends createZodDto(updateCompanySchema) {}
export class GenerateCompanyInviteDto extends createZodDto(
  generateInviteSchema,
) {}
