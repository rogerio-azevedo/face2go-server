import { pgEnum, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { clients } from './clients';

export const clientDisplayDeviceTypeEnum = pgEnum('client_display_device_type', [
  'lpr_camera',
  'facial_reader',
]);

export const clientDisplayDevices = pgTable(
  'client_display_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    deviceType: clientDisplayDeviceTypeEnum('device_type').notNull(),
    deviceId: uuid('device_id').notNull(),
  },
  (t) => [
    uniqueIndex('client_display_devices_client_device_unique').on(
      t.clientId,
      t.deviceType,
      t.deviceId,
    ),
  ],
);
