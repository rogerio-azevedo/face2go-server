import crypto from 'node:crypto';
import { parse as parseUrl } from 'node:url';

import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios';

/** URI do Digest = path + query (Hikvision ISAPI exige ?format=json no uri). */
function digestUriFromRequestUrl(requestUrl: string): string {
  const parsed = parseUrl(requestUrl);
  return `${parsed.pathname ?? ''}${parsed.search ?? ''}`;
}

function parseDigestChallenge(wwwAuthenticate: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w+)=(?:"([^"]*)"|([^,\s]+))/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(wwwAuthenticate)) !== null) {
    out[match[1].toLowerCase()] = (match[2] ?? match[3] ?? '').trim();
  }
  return out;
}

function hashAlgorithmFromChallenge(challenge: Record<string, string>): string {
  const raw = (challenge.algorithm ?? 'MD5').toUpperCase();
  return raw.includes('256') ? 'sha256' : 'md5';
}

type AxiosLikeError = {
  response?: {
    status?: number;
    headers?: Record<string, string | string[] | undefined>;
  };
};

function wwwAuthenticateHeader(err: AxiosLikeError): string | undefined {
  const headers = err.response?.headers;
  if (!headers) return undefined;
  const value = headers['www-authenticate'] ?? headers['WWW-Authenticate'];
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Digest Auth com uri incluindo query string (correção vs @mhoc/axios-digest-auth).
 * Suporta MD5 e SHA-256 conforme challenge do dispositivo.
 */
export class HikvisionDigestAuth {
  private count = 0;

  constructor(
    private readonly axiosInst: AxiosInstance,
    private readonly username: string,
    private readonly password: string,
  ) {}

  async request(opts: AxiosRequestConfig): Promise<AxiosResponse> {
    try {
      return await this.axiosInst.request(opts);
    } catch (firstErr: unknown) {
      const err = firstErr as AxiosLikeError;
      const wwwAuth = wwwAuthenticateHeader(err);
      if (
        err.response?.status !== 401 ||
        !wwwAuth?.toLowerCase().includes('digest') ||
        !wwwAuth.includes('nonce')
      ) {
        throw firstErr;
      }

      const challenge = parseDigestChallenge(wwwAuth);
      const realm = challenge.realm ?? '';
      const nonce = challenge.nonce ?? '';
      const qop = (challenge.qop ?? 'auth').split(',')[0]?.trim() || 'auth';
      const hashName = hashAlgorithmFromChallenge(challenge);

      this.count += 1;
      const nc = `00000000${this.count}`.slice(-8);
      const cnonce = crypto.randomBytes(12).toString('hex');
      const method = (opts.method ?? 'GET').toUpperCase();
      const uri = digestUriFromRequestUrl(String(opts.url ?? ''));

      const ha1 = crypto
        .createHash(hashName)
        .update(`${this.username}:${realm}:${this.password}`)
        .digest('hex');
      const ha2 = crypto
        .createHash(hashName)
        .update(`${method}:${uri}`)
        .digest('hex');
      const response = crypto
        .createHash(hashName)
        .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
        .digest('hex');

      const algorithmAttr = challenge.algorithm
        ? `, algorithm=${challenge.algorithm}`
        : '';

      const authorization =
        `Digest username="${this.username}", realm="${realm}", nonce="${nonce}", ` +
        `uri="${uri}", response="${response}", qop=${qop}, nc=${nc}, cnonce="${cnonce}"` +
        algorithmAttr;

      const headers = {
        ...(opts.headers as Record<string, string> | undefined),
        Authorization: authorization,
      };

      return this.axiosInst.request({ ...opts, headers });
    }
  }
}

export function createHikvisionAxios(timeoutMs: number): AxiosInstance {
  return axios.create({
    timeout: timeoutMs <= 0 ? 0 : timeoutMs,
  });
}

/** Fallback Basic Auth (axios trata user/senha sem montar URL manual). */
export async function requestWithBasicAuth(
  axiosInst: AxiosInstance,
  username: string,
  password: string,
  opts: AxiosRequestConfig,
): Promise<AxiosResponse> {
  return axiosInst.request({
    ...opts,
    auth: { username, password },
  });
}
