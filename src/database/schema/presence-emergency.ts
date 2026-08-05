import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { users } from './auth';
import { clients } from './clients';
import { companies } from './companies';
import { readerDirectionEnum } from './readers';
import { schoolClasses } from './schools';

export const accessPersonTypeEnum = pgEnum('access_person_type', [
  'student',
  'responsible',
  'member',
  'guest',
]);

export const presenceStatusEnum = pgEnum('presence_status', ['in', 'out']);

export const presenceSourceEnum = pgEnum('presence_source', ['facial', 'lpr']);

export const presenceState = pgTable(
  'presence_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    personType: accessPersonTypeEnum('person_type').notNull(),
    personId: uuid('person_id').notNull(),
    personName: varchar('person_name', { length: 255 }).notNull(),
    status: presenceStatusEnum('status').notNull().default('out'),
    lastDirection: readerDirectionEnum('last_direction'),
    lastEventAt: timestamp('last_event_at'),
    lastSource: presenceSourceEnum('last_source'),
    lastDeviceId: uuid('last_device_id'),
    lastDeviceName: varchar('last_device_name', { length: 255 }),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('presence_state_client_person_unique').on(
      t.clientId,
      t.personType,
      t.personId,
    ),
  ],
);

export const emergencyEventStatusEnum = pgEnum('emergency_event_status', [
  'active',
  'resolved',
]);

export const srpActionEnum = pgEnum('srp_action', [
  'hold',
  'secure',
  'lockdown',
  'evacuate',
  'shelter',
  'other',
]);

export const emergencyCheckinStatusEnum = pgEnum('emergency_checkin_status', [
  'pending',
  'safe',
  'not_located',
  'evacuated',
  'injured',
]);

export const emergencyExpectedStatusEnum = pgEnum('emergency_expected_status', [
  'inside',
  'added_manually',
]);

export const emergencyEvents = pgTable('emergency_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  status: emergencyEventStatusEnum('status').notNull().default('active'),
  srpAction: srpActionEnum('srp_action'),
  reason: text('reason'),
  triggeredByUserId: text('triggered_by_user_id')
    .notNull()
    .references(() => users.id),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'),
  resolvedByUserId: text('resolved_by_user_id').references(() => users.id),
  panicEventId: varchar('panic_event_id', { length: 24 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const emergencyCheckins = pgTable(
  'emergency_checkins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    emergencyEventId: uuid('emergency_event_id')
      .notNull()
      .references(() => emergencyEvents.id, { onDelete: 'cascade' }),
    personType: accessPersonTypeEnum('person_type').notNull(),
    personId: uuid('person_id').notNull(),
    personName: varchar('person_name', { length: 255 }).notNull(),
    classId: uuid('class_id').references(() => schoolClasses.id, {
      onDelete: 'set null',
    }),
    className: varchar('class_name', { length: 255 }),
    expectedStatus: emergencyExpectedStatusEnum('expected_status')
      .notNull()
      .default('inside'),
    status: emergencyCheckinStatusEnum('status').notNull().default('pending'),
    statusNote: text('status_note'),
    statusUpdatedByUserId: text('status_updated_by_user_id').references(
      () => users.id,
    ),
    statusUpdatedAt: timestamp('status_updated_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('emergency_checkins_event_person_unique').on(
      t.emergencyEventId,
      t.personType,
      t.personId,
    ),
  ],
);

export const emergencyStatusLog = pgTable('emergency_status_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  emergencyEventId: uuid('emergency_event_id')
    .notNull()
    .references(() => emergencyEvents.id, { onDelete: 'cascade' }),
  checkinId: uuid('checkin_id')
    .notNull()
    .references(() => emergencyCheckins.id, { onDelete: 'cascade' }),
  fromStatus: emergencyCheckinStatusEnum('from_status'),
  toStatus: emergencyCheckinStatusEnum('to_status').notNull(),
  note: text('note'),
  byUserId: text('by_user_id')
    .notNull()
    .references(() => users.id),
  at: timestamp('at').defaultNow().notNull(),
});
