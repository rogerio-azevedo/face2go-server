import { createZodDto } from 'nestjs-zod';

import { createMemberSchema, updateMemberSchema } from '../members.schema';

export class CreateMemberDto extends createZodDto(createMemberSchema) {}
export class PatchMemberDto extends createZodDto(updateMemberSchema) {}
