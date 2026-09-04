import { z } from 'zod';

export const deviceSyncJobDtoSchema = z.object({
  jobId: z.string().uuid(),
  kind: z.string(),
  status: z.enum(['queued', 'running', 'done', 'failed']),
  force: z.boolean(),
  targetId: z.string().uuid(),
  entityKind: z.string().optional(),
  processed: z.number().int(),
  total: z.number().int(),
  error: z.string().nullable(),
});

export const enqueueDeviceSyncBodySchema = z.object({
  force: z.boolean().optional().default(false),
});
