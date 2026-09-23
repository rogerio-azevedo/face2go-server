import type { PlainReaderCredential } from '../intelbras/intelbras-device.client';

export type HikvisionReaderConnection = {
  id?: string;
  baseUrl: string;
  username: string;
  password: string;
  connectionMode?: 'direct' | 'auto_register';
  autoRegisterDeviceId?: string | null;
};

export function toHikvisionConnection(
  reader: PlainReaderCredential,
): HikvisionReaderConnection {
  const port = reader.port ?? 80;
  const baseUrl =
    port === 80 ? `http://${reader.ip}` : `http://${reader.ip}:${port}`;
  return {
    id: reader.id,
    baseUrl,
    username: reader.username,
    password: reader.plainPassword,
    connectionMode: reader.connectionMode ?? 'direct',
    autoRegisterDeviceId: reader.autoRegisterDeviceId ?? null,
  };
}
