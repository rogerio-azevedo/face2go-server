import { createZodDto } from 'nestjs-zod';

import { toggleCompanyFeatureSchema } from '../company-features.schema';

export class ToggleCompanyFeatureDto extends createZodDto(
  toggleCompanyFeatureSchema,
) {}
