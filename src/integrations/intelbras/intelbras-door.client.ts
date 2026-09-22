import { digestAuthForReader } from './intelbras-digest-auth';
import {
  mapReaderError,
  type PlainReaderCredential,
} from './intelbras-device.client';

const REMOTE_OPEN_USER_ID = '999999';

export function intelbrasOpenDoorUrl(
  reader: Pick<PlainReaderCredential, 'ip' | 'port'>,
  channel = 1,
): string {
  const port = reader.port ?? 80;
  const base =
    port === 80 ? `http://${reader.ip}` : `http://${reader.ip}:${port}`;
  return `${base}/cgi-bin/accessControl.cgi?action=openDoor&channel=${channel}&UserID=${REMOTE_OPEN_USER_ID}&Type=Remote`;
}

function responseBodyText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (typeof data === 'number' || typeof data === 'boolean') {
    return String(data);
  }
  if (data == null) return '';
  try {
    return JSON.stringify(data) ?? '';
  } catch {
    return '';
  }
}

export async function intelbrasOpenDoor(
  reader: PlainReaderCredential,
  channel = 1,
): Promise<void> {
  const auth = digestAuthForReader({
    ip: reader.ip,
    port: reader.port,
    username: reader.username,
    plainPassword: reader.plainPassword,
  });
  const url = intelbrasOpenDoorUrl(reader, channel);

  try {
    const response = await auth.request({
      method: 'GET',
      url,
    });
    const body = responseBodyText(response.data);
    if (response.status !== 200 || body.toLowerCase().includes('error')) {
      throw new Error(body.trim() || 'Falha ao acionar a porta do leitor.');
    }
  } catch (err: unknown) {
    throw new Error(mapReaderError(err));
  }
}
