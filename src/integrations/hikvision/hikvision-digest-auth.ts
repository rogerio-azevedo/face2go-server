import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios';

type AxiosLikeError = {
  response?: {
    status?: number;
    headers?: Record<string, string | string[] | undefined> & {
      get?: (name: string) => string | undefined;
    };
  };
};

/** URI do Digest = path + query (Hikvision ISAPI exige ?format=json no uri). */
export function digestUriFromRequestUrl(
  requestUrl: string,
  omitQuery = false,
): string {
  try {
    const parsed = new URL(requestUrl);
    return omitQuery ? parsed.pathname : `${parsed.pathname}${parsed.search}`;
  } catch {
    return requestUrl;
  }
}

export function parseDigestChallenge(
  wwwAuthenticate: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w+)=(?:"([^"]*)"|([^,\s]+))/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(wwwAuthenticate)) !== null) {
    out[match[1].toLowerCase()] = (match[2] ?? match[3] ?? '').trim();
  }
  return out;
}

export function pickDigestWwwAuthenticate(
  value: string | string[] | undefined,
): string | undefined {
  const parts = (Array.isArray(value) ? value : value ? [value] : [])
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const digestPart = parts.find(
    (part) =>
      part.toLowerCase().includes('digest') &&
      part.toLowerCase().includes('nonce'),
  );
  if (digestPart) {
    return digestPart;
  }
  const joined = parts.join(', ');
  if (
    joined.toLowerCase().includes('digest') &&
    joined.toLowerCase().includes('nonce')
  ) {
    return joined;
  }
  return undefined;
}

function headerValue(
  headers:
    | (Record<string, string | string[] | undefined> & {
        get?: (name: string) => string | undefined;
      })
    | undefined,
  name: string,
): string | string[] | undefined {
  if (!headers) {
    return undefined;
  }
  const lower = name.toLowerCase();
  const direct = headers[lower] ?? headers[name];
  if (direct != null) {
    return direct;
  }
  if (typeof headers.get === 'function') {
    return headers.get(lower);
  }
  return undefined;
}

function wwwAuthenticateHeader(err: AxiosLikeError): string | undefined {
  return pickDigestWwwAuthenticate(
    headerValue(err.response?.headers, 'www-authenticate'),
  );
}

export function hashAlgorithmFromChallenge(
  challenge: Record<string, string>,
): string {
  const raw = (challenge.algorithm ?? 'MD5').toUpperCase();
  return raw.includes('256') ? 'sha256' : 'md5';
}

export function buildDigestAuthorization(params: {
  wwwAuth: string;
  username: string;
  password: string;
  method: string;
  url: string;
  nc: number;
  cnonce: string;
  omitQuery?: boolean;
}): string {
  const challenge = parseDigestChallenge(params.wwwAuth);
  const realm = challenge.realm ?? '';
  const nonce = challenge.nonce ?? '';
  const qop = (challenge.qop ?? 'auth').split(',')[0]?.trim() || 'auth';
  const hashName = hashAlgorithmFromChallenge(challenge);
  const nc = `00000000${params.nc}`.slice(-8);
  const method = params.method.toUpperCase();
  const uri = digestUriFromRequestUrl(params.url, params.omitQuery === true);

  const ha1 = crypto
    .createHash(hashName)
    .update(`${params.username}:${realm}:${params.password}`)
    .digest('hex');
  const ha2 = crypto
    .createHash(hashName)
    .update(`${method}:${uri}`)
    .digest('hex');
  const response = crypto
    .createHash(hashName)
    .update(`${ha1}:${nonce}:${nc}:${params.cnonce}:${qop}:${ha2}`)
    .digest('hex');

  const algorithmAttr = challenge.algorithm
    ? `, algorithm=${challenge.algorithm}`
    : '';
  const opaqueAttr = Object.prototype.hasOwnProperty.call(challenge, 'opaque')
    ? `, opaque="${challenge.opaque}"`
    : '';

  return (
    `Digest username="${params.username}", realm="${realm}", nonce="${nonce}", ` +
    `uri="${uri}", response="${response}", qop=${qop}, nc=${nc}, cnonce="${params.cnonce}"` +
    algorithmAttr +
    opaqueAttr
  );
}

/**
 * Digest Auth com uri incluindo query string (correção vs @mhoc/axios-digest-auth).
 * Suporta MD5 e SHA-256 conforme challenge do dispositivo.
 */
export class HikvisionDigestAuth {
  private count = 0;
  private nonceUsed: string | null = null;
  private cachedWwwAuth: string | null = null;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly axiosInst: AxiosInstance,
    private readonly username: string,
    private readonly password: string,
  ) {}

  async request(opts: AxiosRequestConfig): Promise<AxiosResponse> {
    let release: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.tail;
    this.tail = prev.then(
      () => done,
      () => done,
    );
    await prev;
    try {
      return await this.dispatch(opts);
    } finally {
      release();
    }
  }

  private async dispatch(opts: AxiosRequestConfig): Promise<AxiosResponse> {
    if (this.cachedWwwAuth) {
      try {
        return await this.sendDigest(opts, this.cachedWwwAuth, false);
      } catch (firstErr: unknown) {
        const err = firstErr as AxiosLikeError;
        if (err.response?.status !== 401) {
          throw firstErr;
        }
        const wwwAuth = wwwAuthenticateHeader(err) ?? this.cachedWwwAuth;
        return this.retryDigest(opts, wwwAuth, firstErr);
      }
    }

    try {
      return await this.axiosInst.request(opts);
    } catch (firstErr: unknown) {
      const err = firstErr as AxiosLikeError;
      const wwwAuth = wwwAuthenticateHeader(err);
      if (err.response?.status !== 401 || !wwwAuth) {
        throw firstErr;
      }
      this.cachedWwwAuth = wwwAuth;
      return this.retryDigest(opts, wwwAuth, firstErr);
    }
  }

  private async retryDigest(
    opts: AxiosRequestConfig,
    wwwAuth: string,
    originalErr: unknown,
  ): Promise<AxiosResponse> {
    this.cachedWwwAuth = wwwAuth;
    try {
      return await this.sendDigest(opts, wwwAuth, false);
    } catch (digestErr: unknown) {
      const err = digestErr as AxiosLikeError;
      if (err.response?.status !== 401) {
        throw digestErr;
      }
      const nextAuth = wwwAuthenticateHeader(err) ?? wwwAuth;
      this.cachedWwwAuth = nextAuth;
      try {
        return await this.sendDigest(opts, nextAuth, true);
      } catch (pathErr: unknown) {
        this.cachedWwwAuth = null;
        this.nonceUsed = null;
        throw originalErr ?? pathErr;
      }
    }
  }

  private sendDigest(
    opts: AxiosRequestConfig,
    wwwAuth: string,
    omitQuery: boolean,
  ): Promise<AxiosResponse> {
    return this.axiosInst.request({
      ...opts,
      headers: {
        ...(opts.headers as Record<string, string> | undefined),
        Authorization: this.buildAuthorization(wwwAuth, opts, omitQuery),
      },
    });
  }

  private buildAuthorization(
    wwwAuth: string,
    opts: AxiosRequestConfig,
    omitQuery: boolean,
  ): string {
    const challenge = parseDigestChallenge(wwwAuth);
    const nonce = challenge.nonce ?? '';
    if (this.nonceUsed !== nonce) {
      this.count = 0;
      this.nonceUsed = nonce;
    }
    this.count += 1;
    return buildDigestAuthorization({
      wwwAuth,
      username: this.username,
      password: this.password,
      method: String(opts.method ?? 'GET'),
      url: String(opts.url ?? ''),
      nc: this.count,
      cnonce: crypto.randomBytes(12).toString('hex'),
      omitQuery,
    });
  }
}

export function createHikvisionAxios(timeoutMs: number): AxiosInstance {
  const timeout = timeoutMs <= 0 ? 0 : timeoutMs;
  return axios.create({
    timeout,
    httpAgent: new http.Agent({ keepAlive: false }),
    httpsAgent: new https.Agent({ keepAlive: false }),
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
