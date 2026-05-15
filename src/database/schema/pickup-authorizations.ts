import { relations } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { clients } from './clients';
import { responsibles } from './responsibles';
import { students } from './students';

export const pickupAuthorizationStatusEnum = pgEnum(
  'pickup_authorization_status',
  ['active', 'used', 'expired', 'cancelled'],
);

export const temporaryPickupAuthorizations = pgTable(
  'temporary_pickup_authorizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    requestedByResponsibleId: uuid('requested_by_responsible_id')
      .notNull()
      .references(() => responsibles.id, { onDelete: 'cascade' }),
    authorizedResponsibleId: uuid('authorized_responsible_id').references(
      () => responsibles.id,
      { onDelete: 'set null' },
    ),
    guestName: varchar('guest_name', { length: 255 }),
    guestDocument: varchar('guest_document', { length: 64 }),
    guestPhone: varchar('guest_phone', { length: 32 }),
    status: pickupAuthorizationStatusEnum('status').notNull().default('active'),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    notes: text('notes'),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
);

export const temporaryPickupAuthorizationsRelations = relations(
  temporaryPickupAuthorizations,
  ({ one }) => ({
    client: one(clients, {
      fields: [temporaryPickupAuthorizations.clientId],
      references: [clients.id],
    }),
    student: one(students, {
      fields: [temporaryPickupAuthorizations.studentId],
      references: [students.id],
    }),
    requestedBy: one(responsibles, {
      fields: [temporaryPickupAuthorizations.requestedByResponsibleId],
      references: [responsibles.id],
    }),
    authorizedResponsible: one(responsibles, {
      fields: [temporaryPickupAuthorizations.authorizedResponsibleId],
      references: [responsibles.id],
    }),
  }),
);
