import { createZodDto } from 'nestjs-zod';

import { createShiftSchema, updateShiftSchema } from '../shifts.schema';

export class CreateShiftDto extends createZodDto(createShiftSchema) {}
export class PatchShiftDto extends createZodDto(updateShiftSchema) {}
