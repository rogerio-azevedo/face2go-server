import { createZodDto } from 'nestjs-zod';

import { blockPersonSchema } from '../block-person.schema';

export class BlockPersonDto extends createZodDto(blockPersonSchema) {}
