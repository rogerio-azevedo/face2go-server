import http from 'node:http';

import AxiosDigestAuth from '@mhoc/axios-digest-auth';
import axios from 'axios';

type ReaderAuthInput = {
  ip: string;
  port: number;
  username: string;
  plainPassword: string;
};

export type IntelbrasDigestAuth = {
  request: (opts: Record<string, unknown>) => Promise<{
    status?: number;
    data?: unknown;
  }>;
};

const READER_HTTP_TIMEOUT_MS = 10_000;

const intelbrasHttpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 32,
  keepAliveMsecs: 15_000,
});

const digestCache = new Map<string, IntelbrasDigestAuth>();

function readerAuthKey(reader: ReaderAuthInput): string {
  return `${reader.ip}:${reader.port}:${reader.username}`;
}

/** Instância Digest reutilizada por leitor (evita 401+retry em toda request). */
export function digestAuthForReader(
  reader: ReaderAuthInput,
): IntelbrasDigestAuth {
  const key = readerAuthKey(reader);
  const cached = digestCache.get(key);
  if (cached) return cached;

  const axiosInst = axios.create({
    timeout: READER_HTTP_TIMEOUT_MS,
    httpAgent: intelbrasHttpAgent,
  });

  const auth = new AxiosDigestAuth({
    username: reader.username,
    password: reader.plainPassword,
    // @mhoc/axios-digest-auth tipa axios 0.22; o projeto usa 1.x.
    axios: axiosInst as never,
  });
  digestCache.set(key, auth);
  return auth;
}
