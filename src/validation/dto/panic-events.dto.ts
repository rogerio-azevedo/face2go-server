import { createZodDto } from 'nestjs-zod';

import {
  closePanicEventSchema,
  createPanicEventSchema,
  updateClientPanicConfigSchema,
} from '../panic-events.schema';

export class CreatePanicEventDto extends createZodDto(createPanicEventSchema) {}
export class ClosePanicEventDto extends createZodDto(closePanicEventSchema) {}
export class UpdateClientPanicConfigDto extends createZodDto(
  updateClientPanicConfigSchema,
) {}
