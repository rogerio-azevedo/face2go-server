import { createZodDto } from 'nestjs-zod';

import { createVisitorInviteSchema } from '../visitor-invites.schema';

export class CreateVisitorInviteDto extends createZodDto(
  createVisitorInviteSchema,
) {}
