import { relations } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { clients } from './clients';
import { deviceSyncStatusEnum } from './registrations';
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
    /** Sincronização da placa com câmeras LPR Intelbras (TrafficRedList). */
    lprSyncStatus:
      deviceSyncStatusEnum('lpr_sync_status').default('pending_sync'),
    lprSyncError: text('lpr_sync_error'),
    lprSyncedAt: timestamp('lpr_synced_at'),
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
