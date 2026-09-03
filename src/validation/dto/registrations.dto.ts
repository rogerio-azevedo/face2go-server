import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { listRegistrationsQuerySchema } from '../registrations.schema';

const createRegistrationLinkSchema = z
  .object({
    kind: z.enum(['permanent', 'temporary']).default('permanent'),
    validFrom: z.coerce.date().optional(),
    validUntil: z.coerce.date().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.kind !== 'temporary') return;
    if (!val.validFrom) {
      ctx.addIssue({
        code: 'custom',
        message: 'Informe a data inicial da vigência.',
        path: ['validFrom'],
      });
    }
    if (!val.validUntil) {
      ctx.addIssue({
        code: 'custom',
        message: 'Informe a data final da vigência.',
        path: ['validUntil'],
      });
    }
    if (
      val.validFrom &&
      val.validUntil &&
      val.validFrom.getTime() > val.validUntil.getTime()
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'A data final deve ser igual ou posterior à inicial.',
        path: ['validUntil'],
      });
    }
  });

export class CreateRegistrationLinkDto extends createZodDto(
  createRegistrationLinkSchema,
) {}

export class ListRegistrationsQueryDto extends createZodDto(
  listRegistrationsQuerySchema,
) {}
