import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';

import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

import {
  buildDigestAuthorization,
  createHikvisionAxios,
  digestUriFromRequestUrl,
  hashAlgorithmFromChallenge,
  HikvisionDigestAuth,
  parseDigestChallenge,
  pickDigestWwwAuthenticate,
} from './hikvision-digest-auth';

const ROYAL_MIRAGE_CHALLENGE =
  'Digest qop="auth", realm="DS-4E6B3EB9", nonce="Nzc3N2Q2ZTEzZWVmZWVjM2RlMTE0MTEwY2RmYzczNzk=", stale="false", opaque="", domain="::"';

function expectedResponse(params: {
  username: string;
  password: string;
  realm: string;
  nonce: string;
  method: string;
  uri: string;
  nc: string;
  cnonce: string;
  qop: string;
}): string {
  const ha1 = crypto
    .createHash('md5')
    .update(`${params.username}:${params.realm}:${params.password}`)
    .digest('hex');
  const ha2 = crypto
    .createHash('md5')
    .update(`${params.method}:${params.uri}`)
    .digest('hex');
  return crypto
    .createHash('md5')
    .update(
      `${ha1}:${params.nonce}:${params.nc}:${params.cnonce}:${params.qop}:${ha2}`,
    )
    .digest('hex');
}

describe('digestUriFromRequestUrl', () => {
  it('inclui query no uri (ISAPI format=json)', () => {
    expect(
      digestUriFromRequestUrl(
        'http://host:1541/ISAPI/AccessControl/AcsEvent?format=json',
      ),
    ).toBe('/ISAPI/AccessControl/AcsEvent?format=json');
  });

  it('omite query quando pedido', () => {
    expect(
      digestUriFromRequestUrl(
        'http://host:1541/ISAPI/AccessControl/AcsEvent?format=json',
        true,
      ),
    ).toBe('/ISAPI/AccessControl/AcsEvent');
  });
});

describe('parseDigestChallenge', () => {
  it('parseia challenge real (opaque vazio, domain ::, nonce base64)', () => {
    const parsed = parseDigestChallenge(ROYAL_MIRAGE_CHALLENGE);
    expect(parsed.qop).toBe('auth');
    expect(parsed.realm).toBe('DS-4E6B3EB9');
    expect(parsed.nonce).toBe('Nzc3N2Q2ZTEzZWVmZWVjM2RlMTE0MTEwY2RmYzczNzk=');
    expect(parsed.stale).toBe('false');
    expect(parsed.opaque).toBe('');
    expect(parsed.domain).toBe('::');
  });
});

describe('pickDigestWwwAuthenticate', () => {
  it('prefere Digest quando o array começa com Basic', () => {
    const picked = pickDigestWwwAuthenticate([
      'Basic realm="IP Camera"',
      ROYAL_MIRAGE_CHALLENGE,
    ]);
    expect(picked).toBe(ROYAL_MIRAGE_CHALLENGE);
  });

  it('retorna undefined sem nonce Digest', () => {
    expect(pickDigestWwwAuthenticate('Basic realm="x"')).toBeUndefined();
  });
});

describe('hashAlgorithmFromChallenge', () => {
  it('usa md5 por padrão e sha256 quando o challenge pede', () => {
    expect(hashAlgorithmFromChallenge({})).toBe('md5');
    expect(hashAlgorithmFromChallenge({ algorithm: 'MD5' })).toBe('md5');
    expect(hashAlgorithmFromChallenge({ algorithm: 'SHA-256' })).toBe('sha256');
  });
});

describe('buildDigestAuthorization', () => {
  const base = {
    wwwAuth: ROYAL_MIRAGE_CHALLENGE,
    username: 'admin',
    password: 'secret12char',
    nc: 1,
    cnonce: 'abc123cnonce00',
  };

  it('GET e POST geram response distintos (HA2 inclui método)', () => {
    const getHeader = buildDigestAuthorization({
      ...base,
      method: 'GET',
      url: 'http://host:1541/ISAPI/System/deviceInfo',
    });
    const postHeader = buildDigestAuthorization({
      ...base,
      method: 'post',
      url: 'http://host:1541/ISAPI/AccessControl/AcsEvent?format=json',
    });

    expect(getHeader).toContain('uri="/ISAPI/System/deviceInfo"');
    expect(postHeader).toContain(
      'uri="/ISAPI/AccessControl/AcsEvent?format=json"',
    );
    expect(getHeader).not.toBe(postHeader);

    const getResponse = getHeader.match(/response="([^"]+)"/)?.[1];
    const expectedGet = expectedResponse({
      username: 'admin',
      password: 'secret12char',
      realm: 'DS-4E6B3EB9',
      nonce: 'Nzc3N2Q2ZTEzZWVmZWVjM2RlMTE0MTEwY2RmYzczNzk=',
      method: 'GET',
      uri: '/ISAPI/System/deviceInfo',
      nc: '00000001',
      cnonce: 'abc123cnonce00',
      qop: 'auth',
    });
    expect(getResponse).toBe(expectedGet);
  });

  it('ecoar opaque="" quando o challenge envia o campo', () => {
    const header = buildDigestAuthorization({
      ...base,
      method: 'POST',
      url: 'http://host:1541/ISAPI/AccessControl/AcsEvent?format=json',
    });
    expect(header).toContain('opaque=""');
    expect(header).not.toContain('algorithm=');
  });

  it('omite query no uri quando omitQuery=true', () => {
    const header = buildDigestAuthorization({
      ...base,
      method: 'POST',
      url: 'http://host:1541/ISAPI/AccessControl/AcsEvent?format=json',
      omitQuery: true,
    });
    expect(header).toContain('uri="/ISAPI/AccessControl/AcsEvent"');
    expect(header).not.toContain('format=json');
  });
});

describe('createHikvisionAxios', () => {
  it('desliga keep-alive (devices Hikvision fecham no 401)', () => {
    const inst = createHikvisionAxios(12_000);
    const httpAgent = inst.defaults.httpAgent as http.Agent;
    const httpsAgent = inst.defaults.httpsAgent as https.Agent;
    const httpKeepAlive = (httpAgent as { options?: { keepAlive?: boolean } })
      .options?.keepAlive;
    const httpsKeepAlive = (httpsAgent as { options?: { keepAlive?: boolean } })
      .options?.keepAlive;
    expect(httpKeepAlive).toBe(false);
    expect(httpsKeepAlive).toBe(false);
    expect(inst.defaults.timeout).toBe(12_000);
  });
});

describe('HikvisionDigestAuth', () => {
  function mockAxios(
    handler: (opts: AxiosRequestConfig) => Promise<AxiosResponse>,
  ): AxiosInstance {
    return {
      request: jest.fn(handler),
    } as unknown as AxiosInstance;
  }

  function unauthorized(wwwAuth: string | string[]): AxiosLikeError {
    const err = new Error('Request failed with status code 401') as Error & {
      response: { status: number; headers: Record<string, unknown> };
    };
    err.response = {
      status: 401,
      headers: { 'www-authenticate': wwwAuth },
    };
    return err;
  }

  type AxiosLikeError = Error & {
    response: { status: number; headers: Record<string, unknown> };
  };

  it('responde o 401 inicial com Digest incluindo opaque vazio', async () => {
    const auths: string[] = [];
    const axiosInst = mockAxios((opts) => {
      const auth = (opts.headers as Record<string, string> | undefined)
        ?.Authorization;
      if (!auth) {
        return Promise.reject(unauthorized(ROYAL_MIRAGE_CHALLENGE));
      }
      auths.push(auth);
      return Promise.resolve({
        status: 200,
        data: { ok: true },
        headers: {},
        config: opts,
        statusText: 'OK',
      } as AxiosResponse);
    });

    const digest = new HikvisionDigestAuth(axiosInst, 'admin', 'secret12char');
    const res = await digest.request({
      method: 'POST',
      url: 'http://host:1541/ISAPI/AccessControl/AcsEvent?format=json',
    });

    expect(res.status).toBe(200);
    expect(auths).toHaveLength(1);
    expect(auths[0]).toContain('opaque=""');
    expect(auths[0]).toContain(
      'uri="/ISAPI/AccessControl/AcsEvent?format=json"',
    );
  });

  it('no 401 do Digest com query, tenta uri sem query', async () => {
    const uris: string[] = [];
    const axiosInst = mockAxios((opts) => {
      const auth = (opts.headers as Record<string, string> | undefined)
        ?.Authorization;
      if (!auth) {
        return Promise.reject(unauthorized(ROYAL_MIRAGE_CHALLENGE));
      }
      const uri = auth.match(/uri="([^"]+)"/)?.[1] ?? '';
      uris.push(uri);
      if (uri.includes('?')) {
        return Promise.reject(unauthorized(ROYAL_MIRAGE_CHALLENGE));
      }
      return Promise.resolve({
        status: 200,
        data: { ok: true },
        headers: {},
        config: opts,
        statusText: 'OK',
      } as AxiosResponse);
    });

    const digest = new HikvisionDigestAuth(axiosInst, 'admin', 'secret12char');
    const res = await digest.request({
      method: 'POST',
      url: 'http://host:1541/ISAPI/AccessControl/AcsEvent?format=json',
    });

    expect(res.status).toBe(200);
    expect(uris).toEqual([
      '/ISAPI/AccessControl/AcsEvent?format=json',
      '/ISAPI/AccessControl/AcsEvent',
    ]);
  });

  it('serializa requests concorrentes (nc sequencial no mesmo nonce)', async () => {
    const ncs: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const axiosInst = mockAxios(async (opts) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        const auth = (opts.headers as Record<string, string> | undefined)
          ?.Authorization;
        if (!auth) {
          throw unauthorized(ROYAL_MIRAGE_CHALLENGE);
        }
        ncs.push(auth.match(/nc=([0-9a-f]+)/i)?.[1] ?? '');
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          status: 200,
          data: { ok: true },
          headers: {},
          config: opts,
          statusText: 'OK',
        } as AxiosResponse;
      } finally {
        inFlight -= 1;
      }
    });

    const digest = new HikvisionDigestAuth(axiosInst, 'admin', 'secret12char');
    const opts = {
      method: 'POST',
      url: 'http://host:1541/ISAPI/AccessControl/AcsEvent?format=json',
    };
    await Promise.all([digest.request(opts), digest.request(opts)]);

    expect(maxInFlight).toBe(1);
    expect(ncs).toEqual(['00000001', '00000002']);
  });
});
