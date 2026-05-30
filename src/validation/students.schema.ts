import { z } from 'zod';

import { classShiftSchema } from './school-classes.schema';

export const accessScheduleSchema = z
  .object({
    shifts: z.array(classShiftSchema).optional(),
    entryTime: z.string().trim().max(32).optional(),
    exitTime: z.string().trim().max(32).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .nullable()
  .optional();

export const createStudentSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do aluno.').max(255),
  enrollment: z
    .string()
    .trim()
    .min(1, 'Informe a matrícula.')
    .max(64, 'Matrícula muito longa.'),
  document: z.string().trim().max(32).nullable().optional(),
  birthDate: z.coerce.date().nullable().optional(),
  photoKey: z.string().trim().max(2048).nullable().optional(),
  accessSchedule: accessScheduleSchema,
  isActive: z.boolean().optional().default(true),
  classIds: z.array(z.uuid('Turma inválida.')).optional(),
});

export const updateStudentSchema = createStudentSchema.partial();

export const linkStudentClassSchema = z.object({
  classId: z.uuid('Turma inválida.'),
});
