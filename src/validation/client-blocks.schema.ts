import { z } from 'zod';

export const blockNameSchema = z
  .string()
  .trim()
  .min(1, 'Informe o nome do bloco.')
  .max(100);

export const unitNameSchema = z
  .string()
  .trim()
  .min(1, 'Informe a unidade.')
  .max(50);

export const createClientBlockSchema = z.object({
  name: blockNameSchema,
});

export const updateClientBlockSchema = z
  .object({
    name: blockNameSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => value.name !== undefined || value.isActive !== undefined, {
    message: 'Nada para atualizar.',
  });

export const createClientUnitSchema = z.object({
  name: unitNameSchema,
});

export const generateClientUnitsSchema = z
  .object({
    start: z.number().int().min(0).max(99999),
    end: z.number().int().min(0).max(99999),
  })
  .refine((value) => value.end >= value.start, {
    message: 'O fim do intervalo deve ser maior ou igual ao início.',
  });

export const updateClientUnitSchema = z
  .object({
    name: unitNameSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => value.name !== undefined || value.isActive !== undefined, {
    message: 'Nada para atualizar.',
  });

export const mergeClientUnitSchema = z.object({
  targetUnitId: z.uuid(),
});

export type CreateClientBlockInput = z.infer<typeof createClientBlockSchema>;
export type UpdateClientBlockInput = z.infer<typeof updateClientBlockSchema>;
export type CreateClientUnitInput = z.infer<typeof createClientUnitSchema>;
export type GenerateClientUnitsInput = z.infer<
  typeof generateClientUnitsSchema
>;
export type UpdateClientUnitInput = z.infer<typeof updateClientUnitSchema>;
export type MergeClientUnitInput = z.infer<typeof mergeClientUnitSchema>;

export const MAX_GENERATED_UNITS = 500;
