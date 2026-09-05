import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { clients } from './clients';

export const deviceSyncJobKindEnum = pgEnum('device_sync_job_kind', [
  'face.person',
  'face.reader',
  'face.school',
  'lpr.vehicle',
  'lpr.camera',
]);

export const deviceSyncJobStatusEnum = pgEnum('device_sync_job_status', [
  'queued',
  'running',
  'done',
  'failed',
]);

export const deviceSyncJobs = pgTable(
  'device_sync_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: deviceSyncJobKindEnum('kind').notNull(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    targetId: uuid('target_id').notNull(),
    force: boolean('force').notNull().default(false),
    status: deviceSyncJobStatusEnum('status').notNull().default('queued'),
    dedupeKey: text('dedupe_key').notNull(),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    processed: integer('processed').notNull().default(0),
    total: integer('total').notNull().default(0),
    error: text('error'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    startedAt: timestamp('started_at'),
    finishedAt: timestamp('finished_at'),
  },
  (t) => [
    uniqueIndex('device_sync_jobs_dedupe_active')
      .on(t.dedupeKey)
      .where(sql`${t.status} IN ('queued', 'running')`),
    index('device_sync_jobs_status_created_idx').on(t.status, t.createdAt),
    index('device_sync_jobs_client_idx').on(t.clientId),
  ],
);

export type DeviceSyncJobRow = typeof deviceSyncJobs.$inferSelect;
export type DeviceSyncJobKind =
  (typeof deviceSyncJobKindEnum.enumValues)[number];
export type DeviceSyncJobStatus =
  (typeof deviceSyncJobStatusEnum.enumValues)[number];
