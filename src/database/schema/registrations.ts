import { relations } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  boolean,
  text,
  jsonb,
  pgEnum,
} from 'drizzle-orm/pg-core';

import { users } from './auth';
import { clients } from './clients';

export const registrationStatusEnum = pgEnum('registration_status', [
  'draft',
  'approved',
  'rejected',
]);

export const registrationLinks = pgTable('registration_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  createdByUserId: text('created_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 50 }).notNull().unique(),
  isActive: boolean('is_active').default(true).notNull(),
  /** Início da vigência (link temporário). Nulo = permanente ou sem janela inicial. */
  validFrom: timestamp('valid_from'),
  /** Fim da vigência (mesmo significado que “válido até”). Nulo = sem expiração. */
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const registrations = pgTable('registrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  registrationLinkId: uuid('registration_link_id')
    .notNull()
    .references(() => registrationLinks.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }),
  document: varchar('document', { length: 32 }),
  phone: varchar('phone', { length: 32 }),
  email: varchar('email', { length: 255 }),
  faceImageKey: text('face_image_key'),
  additionalData: jsonb('additional_data').$type<{
    block?: string;
    unit?: string;
    room?: string;
  } | null>(),
  status: registrationStatusEnum('status').notNull().default('draft'),
  approvedByUserId: text('approved_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  approvedAt: timestamp('approved_at'),
  rejectionNotes: text('rejection_notes'),
  submittedAt: timestamp('submitted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const registrationLinksRelations = relations(
  registrationLinks,
  ({ one, many }) => ({
    client: one(clients, {
      fields: [registrationLinks.clientId],
      references: [clients.id],
    }),
    createdBy: one(users, {
      fields: [registrationLinks.createdByUserId],
      references: [users.id],
    }),
    registrations: many(registrations),
  }),
);

export const registrationsRelations = relations(registrations, ({ one }) => ({
  registrationLink: one(registrationLinks, {
    fields: [registrations.registrationLinkId],
    references: [registrationLinks.id],
  }),
  client: one(clients, {
    fields: [registrations.clientId],
    references: [clients.id],
  }),
  approvedBy: one(users, {
    fields: [registrations.approvedByUserId],
    references: [users.id],
  }),
}));
