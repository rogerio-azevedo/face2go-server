import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  jsonb,
} from 'drizzle-orm/pg-core';

import { clients } from './clients';

/** Dia da semana (chaves do JSON `schedule`). */
export type ShiftWeekday =
  | 'sunday'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday';

/** Janela de tempo no formato HH:MM (horário local do cliente). */
export type ShiftTimeWindow = {
  start: string;
  end: string;
};

/** Até 4 janelas por dia (limite Intelbras). */
export type ShiftScheduleJson = Partial<
  Record<ShiftWeekday, ShiftTimeWindow[]>
>;

export const shifts = pgTable('shifts', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  schedule: jsonb('schedule')
    .notNull()
    .$type<ShiftScheduleJson>()
    .default(sql`'{}'::jsonb`),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
