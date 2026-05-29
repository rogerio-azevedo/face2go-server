import { relations } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  uuid,
  varchar,
  integer,
  unique,
} from 'drizzle-orm/pg-core';

import { clients } from './clients';
import { deviceSyncStatusEnum } from './registrations';
import { responsibles } from './responsibles';
import { students } from './students';

export const pickupAuthorizationStatusEnum = pgEnum(
  'pickup_authorization_status',
  ['active', 'used', 'expired', 'cancelled'],
);

export const pickupGuestApprovalStatusEnum = pgEnum(
  'pickup_guest_approval_status',
  ['pending_face', 'submitted', 'approved', 'rejected'],
);

export const temporaryPickupAuthorizations = pgTable(
  'temporary_pickup_authorizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    requestedByResponsibleId: uuid('requested_by_responsible_id')
      .notNull()
      .references(() => responsibles.id, { onDelete: 'cascade' }),
    guestName: varchar('guest_name', { length: 255 }).notNull(),
    guestDocument: varchar('guest_document', { length: 64 }).notNull(),
    guestPhone: varchar('guest_phone', { length: 32 }),
    guestLinkCode: varchar('guest_link_code', { length: 50 }),
    guestApprovalStatus: pickupGuestApprovalStatusEnum('guest_approval_status')
      .notNull()
      .default('pending_face'),
    guestFaceImageKey: text('guest_face_image_key'),
    guestFaceId: integer('guest_face_id'),
    guestFaceSyncStatus: deviceSyncStatusEnum('guest_face_sync_status'),
    guestFaceSyncedAt: timestamp('guest_face_synced_at', { withTimezone: true }),
    guestFaceSyncError: text('guest_face_sync_error'),
    guestVehiclePlate: varchar('guest_vehicle_plate', { length: 10 }),
    guestVehicleBrand: varchar('guest_vehicle_brand', { length: 100 }),
    guestVehicleModel: varchar('guest_vehicle_model', { length: 100 }),
    guestVehicleColor: varchar('guest_vehicle_color', { length: 50 }),
    guestVehicleLprSyncStatus: deviceSyncStatusEnum('guest_vehicle_lpr_sync_status'),
    guestVehicleLprSyncedAt: timestamp('guest_vehicle_lpr_synced_at', {
      withTimezone: true,
    }),
    guestVehicleLprSyncError: text('guest_vehicle_lpr_sync_error'),
    status: pickupAuthorizationStatusEnum('status').notNull().default('active'),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    notes: text('notes'),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    guestLinkCodeUnique: unique('temporary_pickup_guest_link_code_unique').on(
      t.guestLinkCode,
    ),
  }),
);

export const pickupAuthorizationStudents = pgTable(
  'pickup_authorization_students',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorizationId: uuid('authorization_id')
      .notNull()
      .references(() => temporaryPickupAuthorizations.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    authStudentUnique: unique('pickup_auth_students_auth_student_unique').on(
      t.authorizationId,
      t.studentId,
    ),
  }),
);

export const temporaryPickupAuthorizationsRelations = relations(
  temporaryPickupAuthorizations,
  ({ one, many }) => ({
    client: one(clients, {
      fields: [temporaryPickupAuthorizations.clientId],
      references: [clients.id],
    }),
    requestedBy: one(responsibles, {
      fields: [temporaryPickupAuthorizations.requestedByResponsibleId],
      references: [responsibles.id],
    }),
    studentLinks: many(pickupAuthorizationStudents),
  }),
);

export const pickupAuthorizationStudentsRelations = relations(
  pickupAuthorizationStudents,
  ({ one }) => ({
    authorization: one(temporaryPickupAuthorizations, {
      fields: [pickupAuthorizationStudents.authorizationId],
      references: [temporaryPickupAuthorizations.id],
    }),
    student: one(students, {
      fields: [pickupAuthorizationStudents.studentId],
      references: [students.id],
    }),
  }),
);
