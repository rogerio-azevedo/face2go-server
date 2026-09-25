import { z } from 'zod';

export const deviceSyncJobStatusSchema = z.enum([
  'queued',
  'running',
  'done',
  'failed',
  'canceled',
]);

export const deviceSyncJobKindSchema = z.enum([
  'face.person',
  'face.reader',
  'face.school',
  'lpr.vehicle',
  'lpr.camera',
]);

export const deviceSyncJobDtoSchema = z.object({
  jobId: z.string().uuid(),
  kind: z.string(),
  status: deviceSyncJobStatusSchema,
  force: z.boolean(),
  targetId: z.string().uuid(),
  entityKind: z.string().optional(),
  processed: z.number().int(),
  total: z.number().int(),
  error: z.string().nullable(),
});

export const enqueueDeviceSyncBodySchema = z
  .object({
    force: z.boolean().optional().default(false),
    allowSimilarFace: z.boolean().optional().default(false),
  })
  .default({ force: false, allowSimilarFace: false });

export const listDeviceSyncJobsQuerySchema = z.object({
  /** `active` = queued + running. */
  status: z.union([deviceSyncJobStatusSchema, z.literal('active')]).optional(),
  kind: deviceSyncJobKindSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const deviceSyncJobListItemSchema = z.object({
  jobId: z.uuid(),
  kind: deviceSyncJobKindSchema,
  status: deviceSyncJobStatusSchema,
  targetId: z.string(),
  /** Pessoa, placa, leitor ou câmera alvo do job. */
  label: z.string().nullable(),
  entityKind: z.string().nullable(),
  force: z.boolean(),
  processed: z.number().int(),
  total: z.number().int(),
  attempts: z.number().int(),
  cancelRequested: z.boolean(),
  error: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});

export const deviceSyncJobListSchema = z.object({
  items: z.array(deviceSyncJobListItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export const deviceSyncJobSummarySchema = z.object({
  queued: z.number().int(),
  running: z.number().int(),
  done: z.number().int(),
  failed: z.number().int(),
  canceled: z.number().int(),
});

export const deviceSyncJobCancelResultSchema = z.object({
  /** `cancel_requested`: job em execução para no próximo item do lote. */
  result: z.enum(['canceled', 'cancel_requested']),
});

export const deviceSyncCancelQueuedResultSchema = z.object({
  canceled: z.number().int(),
});
