import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { clients } from './clients';

export const clientPanicConfig = pgTable('client_panic_config', {
  clientId: uuid('client_id')
    .primaryKey()
    .references(() => clients.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').default(true).notNull(),
  allowedRoles: jsonb('allowed_roles')
    .$type<string[]>()
    .notNull()
    .default(sql`'["member"]'::jsonb`),
  cooldownSeconds: integer('cooldown_seconds').default(60).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
