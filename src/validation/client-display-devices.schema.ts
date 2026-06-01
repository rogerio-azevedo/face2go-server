import { z } from 'zod';

export const CLIENT_DISPLAY_DEVICE_TYPES = [
  'lpr_camera',
  'facial_reader',
] as const;

export const clientDisplayDeviceItemSchema = z.object({
  deviceType: z.enum(CLIENT_DISPLAY_DEVICE_TYPES),
  deviceId: z.string().uuid(),
});

export const setClientDisplayDevicesSchema = z.object({
  devices: z.array(clientDisplayDeviceItemSchema),
});

export type SetClientDisplayDevicesInput = z.infer<
  typeof setClientDisplayDevicesSchema
>;
