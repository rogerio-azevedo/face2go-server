import { sql } from 'drizzle-orm';
import {
  boolean,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { clients } from './clients';

export const geocodingProviderEnum = pgEnum('geocoding_provider', [
  'here',
  'manual',
]);

export const geocodingPrecisionEnum = pgEnum('geocoding_precision', [
  'rooftop',
  'street',
  'approximate',
]);

export const clientAddresses = pgTable(
  'client_addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 100 }).notNull().default('Principal'),
    isPrimary: boolean('is_primary').default(false).notNull(),
    cep: varchar('cep', { length: 9 }),
    street: varchar('street', { length: 255 }),
    number: varchar('number', { length: 20 }),
    complement: varchar('complement', { length: 100 }),
    neighborhood: varchar('neighborhood', { length: 100 }),
    city: varchar('city', { length: 100 }),
    state: varchar('state', { length: 2 }),
    country: varchar('country', { length: 2 }).default('BR').notNull(),
    latitude: numeric('latitude', { precision: 10, scale: 7 }),
    longitude: numeric('longitude', { precision: 10, scale: 7 }),
    geocodingProvider: geocodingProviderEnum('geocoding_provider')
      .default('manual')
      .notNull(),
    geocodingPrecision: geocodingPrecisionEnum('geocoding_precision'),
    hereLocationId: varchar('here_location_id', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('client_addresses_client_primary_unique')
      .on(t.clientId)
      .where(sql`${t.isPrimary} = true`),
  ],
);
