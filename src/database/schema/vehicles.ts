import { relations } from 'drizzle-orm';
import {
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { clients } from './clients';
import { responsibles } from './responsibles';

export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    /** Condutor (responsável vinculado ao aluno): LPR resolve placa → esta pessoa. */
    responsibleId: uuid('responsible_id')
      .notNull()
      .references(() => responsibles.id, { onDelete: 'cascade' }),
    plate: varchar('plate', { length: 10 }).notNull(),
    brand: varchar('brand', { length: 100 }).notNull(),
    model: varchar('model', { length: 100 }).notNull(),
    color: varchar('color', { length: 50 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    plateClientUnique: unique('vehicles_client_plate_unique').on(
      t.clientId,
      t.plate,
    ),
  }),
);

export const vehiclesRelations = relations(vehicles, ({ one }) => ({
  client: one(clients, {
    fields: [vehicles.clientId],
    references: [clients.id],
  }),
  responsible: one(responsibles, {
    fields: [vehicles.responsibleId],
    references: [responsibles.id],
  }),
}));
