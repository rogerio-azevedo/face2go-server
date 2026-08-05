import { createZodDto } from 'nestjs-zod';

import {
  addEmergencyCheckinSchema,
  createEmergencyEventSchema,
  resolveEmergencyEventSchema,
  updateEmergencyCheckinSchema,
} from '../presence-emergency.schema';

export class CreateEmergencyEventDto extends createZodDto(
  createEmergencyEventSchema,
) {}

export class UpdateEmergencyCheckinDto extends createZodDto(
  updateEmergencyCheckinSchema,
) {}

export class AddEmergencyCheckinDto extends createZodDto(
  addEmergencyCheckinSchema,
) {}

export class ResolveEmergencyEventDto extends createZodDto(
  resolveEmergencyEventSchema,
) {}
