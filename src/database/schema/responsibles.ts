import { relations } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  text,
  integer,
  pgEnum,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { users } from './auth';
import { clients } from './clients';
import { deviceSyncStatusEnum } from './registrations';
import { students } from './students';

export const responsibleRelationshipTypeEnum = pgEnum(
  'responsible_relationship_type',
  ['father', 'mother', 'grandfather', 'grandmother', 'guardian', 'other'],
);

export const responsibles = pgTable('responsibles', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 32 }),
  document: varchar('document', { length: 32 }),
  /** Face ID no leitor (mesmo modelo que `students.face_id`), para histórico de acessos do responsável. */
  faceId: integer('face_id'),
  photoKey: text('photo_key'),
  deviceSyncStatus: deviceSyncStatusEnum('device_sync_status'),
  deviceSyncedAt: timestamp('device_synced_at'),
  deviceSyncError: text('device_sync_error'),
  /** Token Expo Push (app do responsável). */
  pushToken: text('push_token'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const responsibleStudents = pgTable(
  'responsible_students',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    responsibleId: uuid('responsible_id')
      .notNull()
      .references(() => responsibles.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    relationshipType: responsibleRelationshipTypeEnum('relationship_type')
      .notNull()
      .default('other'),
    isAuthorizedPickup: boolean('is_authorized_pickup').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('responsible_students_responsible_student_unique').on(
      t.responsibleId,
      t.studentId,
    ),
  ],
);

export const responsiblesRelations = relations(
  responsibles,
  ({ one, many }) => ({
    client: one(clients, {
      fields: [responsibles.clientId],
      references: [clients.id],
    }),
    user: one(users, {
      fields: [responsibles.userId],
      references: [users.id],
    }),
    links: many(responsibleStudents),
  }),
);

export const responsibleStudentsRelations = relations(
  responsibleStudents,
  ({ one }) => ({
    responsible: one(responsibles, {
      fields: [responsibleStudents.responsibleId],
      references: [responsibles.id],
    }),
    student: one(students, {
      fields: [responsibleStudents.studentId],
      references: [students.id],
    }),
  }),
);
