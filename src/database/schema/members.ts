import { relations } from 'drizzle-orm';
import {
  date,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  boolean,
  integer,
} from 'drizzle-orm/pg-core';

import { users } from './auth';
import { clients } from './clients';
import { deviceSyncStatusEnum } from './registrations';
import { registrations } from './registrations';
import { shifts } from './shifts';

export const clientRoles = pgTable(
  'client_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 50 }).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('client_roles_client_slug_unique').on(t.clientId, t.slug),
  ],
);

export const clientMembers = pgTable(
  'client_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => clientRoles.id, { onDelete: 'restrict' }),
    /** Horário de acesso nos leitores (entidade `shifts`). */
    shiftId: uuid('shift_id').references(() => shifts.id, {
      onDelete: 'set null',
    }),
    userId: text('user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    /** Origem em cadastro público aprovado (condomínio/clínica etc.). */
    registrationId: uuid('registration_id').references(() => registrations.id, {
      onDelete: 'set null',
    }),
    name: varchar('name', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 32 }),
    document: varchar('document', { length: 32 }),
    birthDate: date('birth_date'),
    photoKey: text('photo_key'),
    faceId: integer('face_id'),
    deviceSyncStatus: deviceSyncStatusEnum('device_sync_status'),
    deviceSyncedAt: timestamp('device_synced_at'),
    deviceSyncError: text('device_sync_error'),
    pushToken: text('push_token'),
    additionalData: jsonb('additional_data').$type<{
      block?: string;
      unit?: string;
      room?: string;
    } | null>(),
    isActive: boolean('is_active').default(true).notNull(),
    /** Permite cadastrar foto facial de alunos pelo app do funcionário. */
    canEnrollStudentFace: boolean('can_enroll_student_face')
      .default(false)
      .notNull(),
    /** Permite cadastrar foto facial de outros membros pelo app do funcionário. */
    canEnrollMemberFace: boolean('can_enroll_member_face')
      .default(false)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('client_members_client_face_id_unique').on(
      t.clientId,
      t.faceId,
    ),
    uniqueIndex('client_members_registration_unique').on(t.registrationId),
  ],
);

export const clientRolesRelations = relations(clientRoles, ({ one, many }) => ({
  client: one(clients, {
    fields: [clientRoles.clientId],
    references: [clients.id],
  }),
  members: many(clientMembers),
}));

export const clientMembersRelations = relations(clientMembers, ({ one }) => ({
  client: one(clients, {
    fields: [clientMembers.clientId],
    references: [clients.id],
  }),
  role: one(clientRoles, {
    fields: [clientMembers.roleId],
    references: [clientRoles.id],
  }),
  shift: one(shifts, {
    fields: [clientMembers.shiftId],
    references: [shifts.id],
  }),
  user: one(users, {
    fields: [clientMembers.userId],
    references: [users.id],
  }),
  registration: one(registrations, {
    fields: [clientMembers.registrationId],
    references: [registrations.id],
  }),
}));
