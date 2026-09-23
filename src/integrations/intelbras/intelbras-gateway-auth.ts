import http from 'node:http';
import https from 'node:https';

import axios from 'axios';

import type { IntelbrasDigestAuth } from './intelbras-digest-auth';

export type GatewayReaderAuth = {
  id?: string;
  username: string;
  plainPassword: string;
  autoRegisterDeviceId?: string | null;
};

function gatewayHttpsAgent(): https.Agent {
  return new https.Agent({
    rejectUnauthorized: process.env.READER_GATEWAY_TLS_INSECURE !== '1',
  });
}
const gatewayHttpAgent = new http.Agent({ keepAlive: true });

export function gatewayDeviceId(reader: GatewayReaderAuth): string {
  const explicit = reader.autoRegisterDeviceId?.trim();
  if (explicit) return explicit;
  throw new Error('Leitor em registro automático sem ID de dispositivo');
}

/** Path + query que o client monta em `http://ip/cgi-bin/...`. O host é ignorado. */
export function cgiPathFromUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

/**
 * Mesma forma de `digestAuthForReader`, mas o HTTP sai pelo gateway
 * (socket reverso). O corpo volta como texto, como os CGIs Intelbras.
 */
export function createGatewayDigestAuth(
  reader: GatewayReaderAuth,
): IntelbrasDigestAuth {
  const deviceId = gatewayDeviceId(reader);
  return {
    async request(opts) {
      const base = process.env.READER_GATEWAY_URL?.replace(/\/$/, '') ?? '';
      const token = process.env.READER_GATEWAY_TOKEN ?? '';
      if (!base || !token) {
        throw new Error(
          'Leitor em registro automático sem READER_GATEWAY_URL/READER_GATEWAY_TOKEN',
        );
      }
      const method = String(opts.method ?? 'GET');
      const path = cgiPathFromUrl(String(opts.url ?? ''));
      const headers = (opts.headers ?? {}) as Record<string, string>;
      const timeout = Math.max(Number(opts.timeout ?? 0) || 0, 30_000);
      const secure = base.startsWith('https:');
      const response = await axios.post(
        `${base}/devices/${encodeURIComponent(deviceId)}/cgi`,
        {
          method,
          path,
          headers,
          body: opts.data ?? '',
          credentials: {
            username: reader.username,
            password: reader.plainPassword,
          },
        },
        {
          timeout,
          headers: { Authorization: `Bearer ${token}` },
          httpsAgent: secure ? gatewayHttpsAgent() : undefined,
          httpAgent: secure ? undefined : gatewayHttpAgent,
          validateStatus: () => true,
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
      };
      const body =
        typeof payload.body === 'string'
          ? payload.body
          : payload.body == null
            ? ''
            : JSON.stringify(payload.body);
      return { status: payload.status, data: body };
    },
  };
}
