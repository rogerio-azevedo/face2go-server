import { z } from 'zod';

/** Mantido para compatibilidade (JSON legado em alunos etc.). */
export const classShiftSchema = z.enum([
  'morning',
  'afternoon',
  'evening',
  'fulltime',
]);

export const createSchoolClassSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome da turma.').max(255),
  /** FK para entidade `shifts` do mesmo cliente. */
  shiftId: z.string().uuid('Selecione um horário cadastrado.'),
  year: z.number().int().min(2000).max(2100),
  isActive: z.boolean().optional().default(true),
});

export const updateSchoolClassSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  shiftId: z.union([z.string().uuid(), z.null()]).optional(),
  year: z.number().int().min(2000).max(2100).optional(),
  isActive: z.boolean().optional(),
});
