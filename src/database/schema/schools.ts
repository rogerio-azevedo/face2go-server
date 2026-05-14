import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  integer,
  pgEnum,
} from 'drizzle-orm/pg-core';

import { clients } from './clients';
import { shifts } from './shifts';

export const classShiftEnum = pgEnum('class_shift', [
  'morning',
  'afternoon',
  'evening',
  'fulltime',
]);

export const schoolClasses = pgTable('school_classes', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  /** Turno cadastrado (entidade `shifts`). Preferencial na UI e nas regras novas. */
  shiftId: uuid('shift_id').references(() => shifts.id, {
    onDelete: 'set null',
  }),
  /** Enum legado; mantido para turmas antigas sem `shift_id`. */
  shift: classShiftEnum('shift'),
  year: integer('year').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
