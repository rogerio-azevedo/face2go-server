import { createZodDto } from 'nestjs-zod';

import {
  createPickupAuthorizationSchema,
  updatePickupAuthorizationSchema,
} from '../pickup-authorizations.schema';

export class CreatePickupAuthorizationDto extends createZodDto(
  createPickupAuthorizationSchema,
) {}
export class PatchPickupAuthorizationDto extends createZodDto(
  updatePickupAuthorizationSchema,
) {}
