import { createZodDto } from 'nestjs-zod';

import { updateRegistrationFieldsConfigSchema } from '../registration-config.schema';

export class UpdateRegistrationFieldsConfigDto extends createZodDto(
  updateRegistrationFieldsConfigSchema,
) {}
