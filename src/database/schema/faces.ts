import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  jsonb,
} from 'drizzle-orm/pg-core';

import { users } from './auth';
import { clients } from './clients';
import { facialReaders } from './readers';

export const faceStatusEnum = pgEnum('face_status', [
  'pending',
  'active',
  'rejected',
]);

export const faces = pgTable('faces', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  readerId: uuid('reader_id').references(() => facialReaders.id, {
    onDelete: 'set null',
  }),
  faceEmbedding: jsonb('face_embedding'),
  referenceImageUrl: text('reference_image_url'),
  status: faceStatusEnum('status').notNull().default('pending'),
  registeredBy: text('registered_by').references(() => users.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
