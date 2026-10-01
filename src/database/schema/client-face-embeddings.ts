import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { clients } from './clients';

export const clientFaceEmbeddings = pgTable(
  'client_face_embeddings',
  {
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    faceId: integer('face_id').notNull(),
    photoKey: text('photo_key').notNull(),
    blocked: boolean('blocked').notNull().default(false),
    embedding: jsonb('embedding').$type<number[]>().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.clientId, t.faceId] })],
);
