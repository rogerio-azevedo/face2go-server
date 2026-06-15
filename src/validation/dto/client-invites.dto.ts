import { createZodDto } from 'nestjs-zod';

import { generateClientInviteSchema } from '../client-invites.schema';
import {
  createVisitorInviteSchema,
  updateVisitorInviteSchema,
} from '../visitor-invites.schema';

export class GenerateClientInviteLinkDto extends createZodDto(
  generateClientInviteSchema,
) {}
export class CreateClientInviteDto extends createZodDto(
  createVisitorInviteSchema,
) {}
export class PatchClientInviteDto extends createZodDto(
  updateVisitorInviteSchema,
) {}
