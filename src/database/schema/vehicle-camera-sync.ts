import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { cameras } from './cameras';
import { clients } from './clients';
import { deviceSyncStatusEnum } from './registrations';
import { vehicles } from './vehicles';

export const vehicleCameraSync = pgTable(
  'vehicle_camera_sync',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    cameraId: uuid('camera_id')
      .notNull()
      .references(() => cameras.id, { onDelete: 'cascade' }),
    status: deviceSyncStatusEnum('status').notNull(),
    error: text('error'),
    syncedAt: timestamp('synced_at'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('vehicle_camera_sync_client_vehicle_camera_unique').on(
      t.clientId,
      t.vehicleId,
      t.cameraId,
    ),
    index('vehicle_camera_sync_client_vehicle_idx').on(t.clientId, t.vehicleId),
  ],
);

export type VehicleCameraSyncRow = typeof vehicleCameraSync.$inferSelect;
