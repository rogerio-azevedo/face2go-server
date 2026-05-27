import { relations } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  text,
  integer,
  jsonb,
  date,
  uniqueIndex,
  pgEnum,
} from 'drizzle-orm/pg-core';

import { clients } from './clients';
import { deviceSyncStatusEnum } from './registrations';
import { schoolClasses } from './schools';

export const situacaoMatriculaEnum = pgEnum('situacao_matricula', [
  'enrolled',
  'transferred',
  'cancelled',
  'pre_enrolled',
]);

/** Janela/turnos de acesso opcionais por aluno (além do turno da turma). */
export type StudentAccessScheduleJson = {
  shifts?: ('morning' | 'afternoon' | 'evening' | 'fulltime')[];
  entryTime?: string;
  exitTime?: string;
  notes?: string;
} | null;

export const students = pgTable(
  'students',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    classId: uuid('class_id').references(() => schoolClasses.id, {
      onDelete: 'set null',
    }),
    name: varchar('name', { length: 255 }).notNull(),
    enrollment: varchar('enrollment', { length: 64 }).notNull(),
    document: varchar('document', { length: 32 }),
    birthDate: date('birth_date', { mode: 'date' }),
    photoKey: text('photo_key'),
    faceId: integer('face_id'),
    deviceSyncStatus: deviceSyncStatusEnum('device_sync_status'),
    deviceSyncedAt: timestamp('device_synced_at'),
    deviceSyncError: text('device_sync_error'),
    accessSchedule: jsonb('access_schedule').$type<StudentAccessScheduleJson>(),
    situacaoMatricula: situacaoMatriculaEnum('situacao_matricula'),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('students_client_enrollment_unique').on(t.clientId, t.enrollment),
  ],
);

export const studentsRelations = relations(students, ({ one }) => ({
  client: one(clients, {
    fields: [students.clientId],
    references: [clients.id],
  }),
  schoolClass: one(schoolClasses, {
    fields: [students.classId],
    references: [schoolClasses.id],
  }),
}));
