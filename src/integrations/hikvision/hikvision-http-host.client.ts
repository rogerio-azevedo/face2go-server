import type { HikvisionReaderConnection } from './hikvision-connection.types';
import { hikvisionIsapiRequest } from './hikvision-isapi-request';

const PROD_API_FALLBACK = 'https://api.face2go.com.br';

export type HikvisionPushTarget = {
  hostName: string;
  port: number;
  https: boolean;
  path: string;
};

function parsePublicApiUrl(raw?: string): URL | null {
  const value = raw?.trim() || '';
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Host público que o leitor alcança para enviar o evento. */
export function resolveHikvisionPushTarget(
  readerId: string,
  apiUrl?: string,
): HikvisionPushTarget {
  const url =
    parsePublicApiUrl(apiUrl) ??
    parsePublicApiUrl(process.env.API_URL) ??
    parsePublicApiUrl(process.env.APP_PUBLIC_URL) ??
    (process.env.NODE_ENV === 'production'
      ? parsePublicApiUrl(PROD_API_FALLBACK)
      : null);
  if (!url) {
    throw new Error(
      'API_URL (ou APP_PUBLIC_URL) não configurada — o leitor precisa de um host alcançável',
    );
  }
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    throw new Error(
      'API_URL aponta para localhost — o leitor não alcança esse host',
    );
  }
  const https = url.protocol === 'https:';
  const port = url.port ? Number(url.port) : https ? 443 : 80;
  return {
    hostName: url.hostname,
    port,
    https,
    path: `/device-events/hikvision/${readerId}`,
  };
}

export function buildHikvisionHttpHostBody(
  target: HikvisionPushTarget,
): Record<string, unknown> {
  return {
    HttpHostNotification: {
      id: 1,
      url: target.path,
      protocolType: target.https ? 'HTTPS' : 'HTTP',
      parameterFormatType: 'JSON',
      addressingFormatType: 'hostname',
      hostName: target.hostName,
      portNo: target.port,
      httpAuthenticationMethod: 'none',
    },
  };
}

export async function hikvisionConfigureHttpHost(
  connection: HikvisionReaderConnection,
  target: HikvisionPushTarget,
): Promise<void> {
  await hikvisionIsapiRequest(connection, {
    method: 'PUT',
    url: `${connection.baseUrl}/ISAPI/Event/notification/httpHosts/1?format=json`,
    headers: { 'Content-Type': 'application/json' },
    data: buildHikvisionHttpHostBody(target),
  });
}
