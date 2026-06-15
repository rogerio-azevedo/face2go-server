import { createZodDto } from 'nestjs-zod';

import {
  createManagedResponsibleSchema,
  createResponsibleInvitationSchema,
} from '../managed-responsibles.schema';

export class CreateManagedResponsibleDto extends createZodDto(
  createManagedResponsibleSchema,
) {}
export class CreateManagedResponsibleInvitationDto extends createZodDto(
  createResponsibleInvitationSchema,
) {}
