import { createZodDto } from 'nestjs-zod';

import { createReaderSchema, updateReaderSchema } from '../readers.schema';

export class CreateReaderDto extends createZodDto(createReaderSchema) {}
export class PatchReaderDto extends createZodDto(updateReaderSchema) {}
