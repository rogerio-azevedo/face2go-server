import type { PlainReaderCredential } from '../intelbras/intelbras-device.client';

export type HikvisionReaderConnection = {
  baseUrl: string;
  username: string;
  password: string;
};

export function toHikvisionConnection(
  reader: PlainReaderCredential,
): HikvisionReaderConnection {
  const port = reader.port ?? 80;
  const baseUrl =
    port === 80 ? `http://${reader.ip}` : `http://${reader.ip}:${port}`;
  return {
    baseUrl,
    username: reader.username,
    password: reader.plainPassword,
  };
}
