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

const floorsShape = {
  floorStart: z.number().int().min(1).max(99),
  floorEnd: z.number().int().min(1).max(99),
  unitsPerFloor: z.number().int().min(1).max(99),
};

const floorsInOrder = (value: { floorStart: number; floorEnd: number }) =>
  value.floorEnd >= value.floorStart;
const FLOORS_ORDER_MESSAGE =
  'O último andar deve ser maior ou igual ao primeiro.';

export const generateClientUnitsSchema = z
  .object(floorsShape)
  .refine(floorsInOrder, { message: FLOORS_ORDER_MESSAGE });

export const generateStructureSchema = z
  .object({
    blockStart: z.number().int().min(0).max(9999),
    blockEnd: z.number().int().min(0).max(9999),
    blockDigits: z.number().int().min(1).max(4).default(2),
    ...floorsShape,
  })
  .refine((value) => value.blockEnd >= value.blockStart, {
    message: 'O último bloco deve ser maior ou igual ao primeiro.',
  })
  .refine(floorsInOrder, { message: FLOORS_ORDER_MESSAGE });

export const updateClientUnitSchema = z
  .object({
    name: unitNameSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => value.name !== undefined || value.isActive !== undefined, {
    message: 'Nada para atualizar.',
  });

export const ensureLocationUnitSchema = z.object({
  blockName: blockNameSchema,
  unitName: unitNameSchema,
});

export const bindLocationGroupSchema = z
  .object({
    blockText: z.string().max(200),
    unitText: z.string().max(200),
    unitId: z.uuid(),
  })
  .refine(
    (value) => value.blockText.trim() !== '' || value.unitText.trim() !== '',
    {
      message: 'Quem está sem localização deve ser vinculado no cadastro.',
    },
  );

export const bindLocationGroupsSchema = z.object({
  items: z.array(bindLocationGroupSchema).min(1).max(500),
});

export type CreateClientBlockInput = z.infer<typeof createClientBlockSchema>;
export type UpdateClientBlockInput = z.infer<typeof updateClientBlockSchema>;
export type CreateClientUnitInput = z.infer<typeof createClientUnitSchema>;
export type GenerateClientUnitsInput = z.infer<
  typeof generateClientUnitsSchema
>;
export type GenerateStructureInput = z.infer<typeof generateStructureSchema>;
export type UpdateClientUnitInput = z.infer<typeof updateClientUnitSchema>;
export type EnsureLocationUnitInput = z.infer<typeof ensureLocationUnitSchema>;
export type BindLocationGroupInput = z.infer<typeof bindLocationGroupSchema>;

export const MAX_GENERATED_UNITS = 500;
export const MAX_STRUCTURE_BLOCKS = 500;
export const MAX_STRUCTURE_UNITS = 5000;
