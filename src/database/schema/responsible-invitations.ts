import { relations } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  uuid,
  varchar,
  unique,
  boolean,
} from 'drizzle-orm/pg-core';

import { clients } from './clients';
import { deviceSyncStatusEnum } from './registrations';
import { responsibleRelationshipTypeEnum } from './responsibles';
import { responsibles } from './responsibles';
import { students } from './students';

export const responsibleInvitationStatusEnum = pgEnum(
  'responsible_invitation_status',
  ['pending', 'submitted', 'approved', 'rejected', 'cancelled'],
);

export const responsibleInvitationApprovalStatusEnum = pgEnum(
  'responsible_invitation_approval_status',
  ['pending', 'submitted', 'approved', 'rejected'],
);

export const responsibleInvitations = pgTable(
  'responsible_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    inviterResponsibleId: uuid('inviter_responsible_id')
      .notNull()
      .references(() => responsibles.id, { onDelete: 'cascade' }),
    guestLinkCode: varchar('guest_link_code', { length: 50 }),
    status: responsibleInvitationStatusEnum('status').notNull().default('pending'),
    faceApprovalStatus: responsibleInvitationApprovalStatusEnum(
      'face_approval_status',
    )
      .notNull()
      .default('pending'),
    plateApprovalStatus: responsibleInvitationApprovalStatusEnum(
      'plate_approval_status',
    )
      .notNull()
      .default('pending'),
    submittedName: varchar('submitted_name', { length: 255 }),
    submittedEmail: varchar('submitted_email', { length: 255 }),
    submittedPhone: varchar('submitted_phone', { length: 32 }),
    submittedDocument: varchar('submitted_document', { length: 32 }),
    submittedPasswordHash: text('submitted_password_hash'),
    faceImageKey: text('face_image_key'),
    vehiclePlate: varchar('vehicle_plate', { length: 10 }),
    vehicleBrand: varchar('vehicle_brand', { length: 100 }),
    vehicleModel: varchar('vehicle_model', { length: 100 }),
    vehicleColor: varchar('vehicle_color', { length: 50 }),
    createdResponsibleId: uuid('created_responsible_id').references(
      () => responsibles.id,
      { onDelete: 'set null' },
    ),
    faceSyncStatus: deviceSyncStatusEnum('face_sync_status'),
    faceSyncedAt: timestamp('face_synced_at', { withTimezone: true }),
    faceSyncError: text('face_sync_error'),
    plateLprSyncStatus: deviceSyncStatusEnum('plate_lpr_sync_status'),
    plateLprSyncedAt: timestamp('plate_lpr_synced_at', { withTimezone: true }),
    plateLprSyncError: text('plate_lpr_sync_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    guestLinkCodeUnique: unique('responsible_invitation_guest_link_code_unique').on(
      t.guestLinkCode,
    ),
  }),
);

export const responsibleInvitationStudents = pgTable(
  'responsible_invitation_students',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invitationId: uuid('invitation_id')
      .notNull()
      .references(() => responsibleInvitations.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    relationshipType: responsibleRelationshipTypeEnum('relationship_type')
      .notNull()
      .default('other'),
    isAuthorizedPickup: boolean('is_authorized_pickup').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    invitationStudentUnique: unique(
      'responsible_invitation_students_invitation_student_unique',
    ).on(t.invitationId, t.studentId),
  }),
);

export const responsibleInvitationsRelations = relations(
  responsibleInvitations,
  ({ one, many }) => ({
    client: one(clients, {
      fields: [responsibleInvitations.clientId],
      references: [clients.id],
    }),
    inviter: one(responsibles, {
      fields: [responsibleInvitations.inviterResponsibleId],
      references: [responsibles.id],
    }),
    createdResponsible: one(responsibles, {
      fields: [responsibleInvitations.createdResponsibleId],
      references: [responsibles.id],
    }),
    studentLinks: many(responsibleInvitationStudents),
  }),
);

export const responsibleInvitationStudentsRelations = relations(
  responsibleInvitationStudents,
  ({ one }) => ({
    invitation: one(responsibleInvitations, {
      fields: [responsibleInvitationStudents.invitationId],
      references: [responsibleInvitations.id],
    }),
    student: one(students, {
      fields: [responsibleInvitationStudents.studentId],
      references: [students.id],
    }),
  }),
);
