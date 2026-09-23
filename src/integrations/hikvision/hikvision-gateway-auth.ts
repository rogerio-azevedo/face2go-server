import http from 'node:http';
import https from 'node:https';

import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';

import type { HikvisionReaderConnection } from './hikvision-connection.types';

function gatewayHttpsAgent(): https.Agent {
  return new https.Agent({
    rejectUnauthorized: process.env.READER_GATEWAY_TLS_INSECURE !== '1',
  });
}
const gatewayHttpAgent = new http.Agent({ keepAlive: true });

export function hikvisionGatewayDeviceId(
  connection: Pick<HikvisionReaderConnection, 'id' | 'autoRegisterDeviceId'>,
): string {
  const explicit = connection.autoRegisterDeviceId?.trim();
  if (explicit) return explicit;
  if (connection.id?.trim()) return connection.id.trim();
  throw new Error('Leitor Hikvision em registro automático sem ID EHome');
}

/** Path + query da URL ISAPI. O host do leitor é ignorado. */
export function isapiPathFromUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

function headerRecord(
  headers: AxiosRequestConfig['headers'],
): Record<string, string> {
  if (!headers) return {};
  const out: Record<string, string> = {};
  const asJson = headers as { toJSON?: () => Record<string, unknown> };
  const source =
    typeof asJson.toJSON === 'function'
      ? asJson.toJSON()
      : (headers as Record<string, unknown>);
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' || typeof value === 'number') {
      out[key] = String(value);
    }
  }
  return out;
}

function encodeBody(data: unknown): { body?: string; bodyBase64?: string } {
  if (data == null) return {};
  if (Buffer.isBuffer(data)) return { bodyBase64: data.toString('base64') };
  if (data instanceof Uint8Array) {
    return { bodyBase64: Buffer.from(data).toString('base64') };
  }
  if (typeof data === 'string') return { body: data };
  return { body: JSON.stringify(data) };
}

function decodeGatewayBody(
  payload: { body?: unknown; bodyBase64?: unknown },
  responseType: AxiosRequestConfig['responseType'],
): unknown {
  if (responseType === 'arraybuffer') {
    if (typeof payload.bodyBase64 === 'string' && payload.bodyBase64.length > 0) {
      return Buffer.from(payload.bodyBase64, 'base64');
    }
    if (typeof payload.body === 'string') return Buffer.from(payload.body);
    return Buffer.alloc(0);
  }
  if (typeof payload.bodyBase64 === 'string' && payload.bodyBase64.length > 0) {
    return Buffer.from(payload.bodyBase64, 'base64');
  }
  if (typeof payload.body !== 'string') return payload.body ?? '';
  const trimmed = payload.body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return payload.body;
    }
  }
  return payload.body;
}

/**
 * ISAPI pelo processo ISUP. Sem HIK_GATEWAY_URL/HIK_GATEWAY_TOKEN o comando
 * falha: o IP do leitor atrás de CGNAT não é alcançável.
 */
export async function hikvisionGatewayIsapiRequest(
  connection: HikvisionReaderConnection,
  opts: AxiosRequestConfig,
): Promise<AxiosResponse> {
  const base = process.env.HIK_GATEWAY_URL?.replace(/\/$/, '') ?? '';
  const token = process.env.HIK_GATEWAY_TOKEN ?? '';
  if (!base || !token) {
    throw new Error(
      'Leitor Hikvision em registro automático sem HIK_GATEWAY_URL/HIK_GATEWAY_TOKEN',
    );
  }
  const deviceId = hikvisionGatewayDeviceId(connection);
  const method = String(opts.method ?? 'GET');
  const path = isapiPathFromUrl(String(opts.url ?? ''));
  const timeout = Math.max(Number(opts.timeout ?? 0) || 0, 30_000);
  const secure = base.startsWith('https:');
  const response = await axios.post(
    `${base}/devices/${encodeURIComponent(deviceId)}/isapi`,
    {
      method,
      path,
      headers: headerRecord(opts.headers),
      ...encodeBody(opts.data),
      credentials: {
        username: connection.username,
        password: connection.password,
      },
    },
    {
      timeout,
      headers: { Authorization: `Bearer ${token}` },
      httpsAgent: secure ? gatewayHttpsAgent() : undefined,
      httpAgent: secure ? undefined : gatewayHttpAgent,
      validateStatus: () => true,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    },
  );
  if (response.status >= 400) {
    const data = response.data as { error?: unknown } | string;
    const message =
      typeof data === 'object' && data?.error != null
        ? String(data.error)
        : `gateway HTTP ${response.status}`;
    const err = new Error(message) as Error & {
      response?: { status?: number; data?: unknown };
    };
    err.response = { status: response.status, data: response.data };
    throw err;
  }
  const payload = response.data as {
    status?: number;
    body?: unknown;
    bodyBase64?: unknown;
    headers?: Record<string, string>;
  };
  const status = payload.status ?? 200;
  const data = decodeGatewayBody(payload, opts.responseType);
  if (status >= 400) {
    const err = new Error(`Hikvision ISAPI ${status}`) as Error & {
      response?: { status?: number; data?: unknown };
    };
    err.response = { status, data };
    throw err;
  }
  return {
    status,
    data,
    headers: payload.headers ?? {},
    config: opts,
    statusText: '',
  } as AxiosResponse;
}
