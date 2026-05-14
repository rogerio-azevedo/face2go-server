import { relations } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  text,
  pgEnum,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { users } from './auth';
import { clients } from './clients';
import { students } from './students';

export const parentRelationshipTypeEnum = pgEnum('parent_relationship_type', [
  'father',
  'mother',
  'grandfather',
  'grandmother',
  'guardian',
  'other',
]);

export const parents = pgTable('parents', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 32 }),
  document: varchar('document', { length: 32 }),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const parentStudents = pgTable(
  'parent_students',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentId: uuid('parent_id')
      .notNull()
      .references(() => parents.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    relationshipType: parentRelationshipTypeEnum('relationship_type')
      .notNull()
      .default('other'),
    isAuthorizedPickup: boolean('is_authorized_pickup').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('parent_students_parent_student_unique').on(
      t.parentId,
      t.studentId,
    ),
  ],
);

export const parentsRelations = relations(parents, ({ one, many }) => ({
  client: one(clients, {
    fields: [parents.clientId],
    references: [clients.id],
  }),
  user: one(users, {
    fields: [parents.userId],
    references: [users.id],
  }),
  links: many(parentStudents),
}));

export const parentStudentsRelations = relations(parentStudents, ({ one }) => ({
  parent: one(parents, {
    fields: [parentStudents.parentId],
    references: [parents.id],
  }),
  student: one(students, {
    fields: [parentStudents.studentId],
    references: [students.id],
  }),
}));
