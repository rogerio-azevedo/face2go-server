import { relations } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  integer,
  unique,
} from 'drizzle-orm/pg-core';

import { clients } from './clients';
import { clientMembers } from './members';
import { deviceSyncStatusEnum } from './registrations';
import {
  pickupAuthorizationStatusEnum,
  pickupGuestApprovalStatusEnum,
} from './pickup-authorizations';

export const clientInvites = pgTable(
  'client_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    requestedByMemberId: uuid('requested_by_member_id')
      .notNull()
      .references(() => clientMembers.id, { onDelete: 'cascade' }),
    guestName: varchar('guest_name', { length: 255 }),
    guestDocument: varchar('guest_document', { length: 64 }),
    guestPhone: varchar('guest_phone', { length: 32 }),
    guestLinkCode: varchar('guest_link_code', { length: 50 }),
    guestApprovalStatus: pickupGuestApprovalStatusEnum('guest_approval_status')
      .notNull()
      .default('pending_face'),
    guestFaceImageKey: text('guest_face_image_key'),
    guestFaceId: integer('guest_face_id'),
    guestFaceSyncStatus: deviceSyncStatusEnum('guest_face_sync_status'),
    guestFaceSyncedAt: timestamp('guest_face_synced_at', {
      withTimezone: true,
    }),
    guestFaceSyncError: text('guest_face_sync_error'),
    guestVehiclePlate: varchar('guest_vehicle_plate', { length: 10 }),
    guestVehicleBrand: varchar('guest_vehicle_brand', { length: 100 }),
    guestVehicleModel: varchar('guest_vehicle_model', { length: 100 }),
    guestVehicleColor: varchar('guest_vehicle_color', { length: 50 }),
    guestVehicleLprSyncStatus: deviceSyncStatusEnum(
      'guest_vehicle_lpr_sync_status',
    ),
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
    guestLinkCodeUnique: unique('client_invites_guest_link_code_unique').on(
      t.guestLinkCode,
    ),
  }),
);

export const clientInvitesRelations = relations(clientInvites, ({ one }) => ({
  client: one(clients, {
    fields: [clientInvites.clientId],
    references: [clients.id],
  }),
  requestedBy: one(clientMembers, {
    fields: [clientInvites.requestedByMemberId],
    references: [clientMembers.id],
  }),
}));
