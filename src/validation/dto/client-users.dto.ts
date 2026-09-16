import { createZodDto } from 'nestjs-zod';

import {
  patchClientUserActiveSchema,
  patchClientUserPasswordSchema,
  patchClientUserProfileSchema,
  patchClientUserRoleSchema,
} from '../client-users.schema';

export class PatchClientUserRoleDto extends createZodDto(
  patchClientUserRoleSchema,
) {}
export class PatchClientUserActiveDto extends createZodDto(
  patchClientUserActiveSchema,
) {}
export class PatchClientUserProfileDto extends createZodDto(
  patchClientUserProfileSchema,
) {}
export class PatchClientUserPasswordDto extends createZodDto(
  patchClientUserPasswordSchema,
) {}
