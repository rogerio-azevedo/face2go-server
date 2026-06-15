import { createZodDto } from 'nestjs-zod';

import {
  createStudentSchema,
  linkStudentClassSchema,
  updateStudentSchema,
} from '../students.schema';

export class CreateStudentDto extends createZodDto(createStudentSchema) {}
export class PatchStudentDto extends createZodDto(updateStudentSchema) {}
export class LinkStudentClassDto extends createZodDto(linkStudentClassSchema) {}
