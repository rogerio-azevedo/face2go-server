import { z } from 'zod';

export const fetchIenhSchema = z.object({
  perlet: z
    .string()
    .min(4, 'PERLET deve ter ao menos 4 caracteres.')
    .optional(),
  filiais: z.array(z.coerce.number().int().min(1).max(3)).min(1).optional(),
  niveis: z.array(z.coerce.number().int().min(1).max(3)).min(1).optional(),
});

export type FetchIenhInput = z.infer<typeof fetchIenhSchema>;

export const syncIenhSchema = z.object({
  perlet: z
    .string()
    .min(4, 'PERLET deve ter ao menos 4 caracteres.')
    .optional(),
  niveis: z.array(z.coerce.number().int().min(1).max(3)).min(1).optional(),
});

export const setIenhFilialMappingSchema = z.object({
  filialCode: z.coerce.number().int().min(1).max(3),
  clientId: z.string().uuid().nullable(),
});

export type SyncIenhInput = z.infer<typeof syncIenhSchema>;

const snapshotFilenameSchema = z
  .string()
  .regex(/^ienh-snapshot-\d{8}-\d{4}\.json$/, 'Nome de snapshot inválido.');

export const syncFromSnapshotSchema = z.object({
  file: snapshotFilenameSchema,
});

export type SyncFromSnapshotInput = z.infer<typeof syncFromSnapshotSchema>;
