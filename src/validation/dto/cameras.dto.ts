import { createZodDto } from 'nestjs-zod';

import { createCameraSchema, updateCameraSchema } from '../cameras.schema';

export class CreateCameraDto extends createZodDto(createCameraSchema) {}
export class PatchCameraDto extends createZodDto(updateCameraSchema) {}
