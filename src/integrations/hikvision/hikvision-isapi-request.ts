import { type AxiosRequestConfig, type AxiosResponse } from 'axios';

import {
  createHikvisionAxios,
  HikvisionDigestAuth,
  requestWithBasicAuth,
} from './hikvision-digest-auth';
import type { HikvisionReaderConnection } from './hikvision-connection.types';

function readerHttpTimeoutMs(): number {
  const fromEnv = Number(process.env.FACIAL_READER_HTTP_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0
    ? Math.min(fromEnv, 120_000)
    : 12_000;
}

type AxiosLikeError = {
  response?: { status?: number };
};

type CachedHikvisionClient = {
  digest: HikvisionDigestAuth;
  axiosInst: ReturnType<typeof createHikvisionAxios>;
};

const hikvisionClientCache = new Map<string, CachedHikvisionClient>();

function hikvisionClient(
  connection: Pick<
    HikvisionReaderConnection,
    'username' | 'password' | 'baseUrl'
  >,
  timeoutMs: number,
): CachedHikvisionClient {
  const key = `${connection.baseUrl}\0${connection.username}\0${timeoutMs}`;
  const cached = hikvisionClientCache.get(key);
  if (cached) return cached;
  const axiosInst = createHikvisionAxios(timeoutMs);
  const digest = new HikvisionDigestAuth(
    axiosInst,
    connection.username,
    connection.password,
  );
  const created = { digest, axiosInst };
  hikvisionClientCache.set(key, created);
  return created;
}

/**
 * Requisição ISAPI Hikvision: Digest (uri com query) e fallback Basic Auth.
 */
export async function hikvisionIsapiRequest(
  connection: Pick<
    HikvisionReaderConnection,
    'username' | 'password' | 'baseUrl'
  >,
  opts: AxiosRequestConfig,
  forStream = false,
): Promise<AxiosResponse> {
  const timeoutMs = forStream ? 0 : readerHttpTimeoutMs();
  const { digest, axiosInst } = hikvisionClient(connection, timeoutMs);

  try {
    return await digest.request(opts);
  } catch (firstErr: unknown) {
    const status = (firstErr as AxiosLikeError).response?.status;
    if (status !== 401) {
      throw firstErr;
    }

    try {
      return await requestWithBasicAuth(
        axiosInst,
        connection.username,
        connection.password,
        opts,
      );
    } catch {
      throw firstErr;
    }
  }
}

/** Abre alertStream ISAPI (Digest com query no uri; fallback Basic Auth). */
export async function hikvisionOpenStreamRequest(
  connection: Pick<
    HikvisionReaderConnection,
    'username' | 'password' | 'baseUrl'
  >,
  url: string,
  signal?: AbortSignal,
): Promise<AxiosResponse> {
  const { digest, axiosInst } = hikvisionClient(connection, 0);
  const opts: AxiosRequestConfig = {
    method: 'GET',
    url,
    responseType: 'stream',
    timeout: 0,
    signal,
  };

  try {
    return await digest.request(opts);
  } catch (firstErr: unknown) {
    const status = (firstErr as AxiosLikeError).response?.status;
    if (status !== 401) {
      throw firstErr;
    }
    return requestWithBasicAuth(
      axiosInst,
      connection.username,
      connection.password,
      opts,
    );
  }
}
