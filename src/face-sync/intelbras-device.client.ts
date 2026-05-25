import AxiosDigestAuth from '@mhoc/axios-digest-auth';

import type { ReaderFaceSyncRow } from '../database/queries/readers.queries';
import {
  DEFAULT_INTELBRAS_VALID_DATE_END,
  DEFAULT_INTELBRAS_VALID_DATE_START,
} from './intelbras-valid-date.util';
import { normalizeNameForFacialReader } from './normalize-name-for-reader';

export type PlainReaderCredential = {
  id: string;
  name: string;
  ip: string;
  port: number;
  username: string;
  plainPassword: string;
};

export function toPlainReaderCredential(
  row: ReaderFaceSyncRow,
  decryptedPassword: string,
): PlainReaderCredential {
  return {
    id: row.id,
    name: row.name,
    ip: row.ip.trim(),
    port: row.port ?? 80,
    username: row.username.trim(),
    plainPassword: decryptedPassword,
  };
}

function deviceUrl(reader: PlainReaderCredential): string {
  const port = reader.port ?? 80;
  return port === 80
    ? `http://${reader.ip}`
    : `http://${reader.ip}:${port}`;
}

const OFFLINE_ERRNO_CODES = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'ENETUNREACH',
  'ECONNABORTED',
]);

function errnoCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const c = (err as NodeJS.ErrnoException).code;
  return typeof c === 'string' ? c : undefined;
}

function coerceHttpStatus(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = Math.trunc(raw);
    return n >= 100 && n <= 599 ? n : undefined;
  }
  if (typeof raw === 'string') {
    const m = /^(\d{3})$/.exec(raw.trim());
    if (m) return parseInt(m[1], 10);
  }
  return undefined;
}

function walkErrorRoots(err: unknown): unknown[] {
  const out: unknown[] = [];
  const queue: unknown[] = [err];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === null || cur === undefined) continue;

    if (typeof cur !== 'object') {
      continue;
    }
    if (seen.has(cur)) continue;
    seen.add(cur);
    out.push(cur);

    const cause = (cur as { cause?: unknown }).cause;
    if (cause !== undefined) queue.push(cause);

    if (cur instanceof AggregateError && Array.isArray(cur.errors)) {
      queue.push(...cur.errors);
    }
  }
  return out;
}

/** Status HTTP vindos do Axios/outros clientes (`response.status` pode vir como string). */
function httpStatusFromError(err: unknown): number | undefined {
  for (const node of walkErrorRoots(err)) {
    if (typeof node !== 'object' || node === null) continue;
    const r = node as {
      response?: { status?: unknown };
      status?: unknown;
      statusCode?: unknown;
    };
    const fromResp =
      coerceHttpStatus(r.response?.status) ??
      coerceHttpStatus((r.response as { statusCode?: unknown } | undefined)?.statusCode);
    if (fromResp !== undefined) return fromResp;

    const top = coerceHttpStatus(r.status) ?? coerceHttpStatus(r.statusCode);
    if (top !== undefined) return top;
  }

  for (const node of walkErrorRoots(err)) {
    const raw =
      node instanceof Error
        ? node.message
        : typeof node === 'string'
          ? node
          : '';
    if (!raw) continue;

    const patterns = [
      /status\s*(?:code)?\D{0,3}(\d{3})\b/i,
      /\b(?:http\s*)?(\d{3})\s+(?:response|error)\b/i,
    ];
    for (const pattern of patterns) {
      const m = pattern.exec(raw);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n >= 100 && n <= 599) return n;
      }
    }
  }

  return undefined;
}

/**
 * Fluxo facial: mensagens mencionam "leitor" e HTTP 400 costuma significar foto/rosto inválidos.
 * Fluxo LPR: HTTP 400 em CGI de placas é outro contexto — não reutilizar mensagem de face.
 */
export type IntelbrasHttpMessaging = 'facial' | 'lpr';

const INTELBRAS_ERR_MSG = {
  facial: {
    offline: 'Leitor offline ou inacessível',
    bad400:
      'Foto rejeitada pelo leitor: rosto não detectado ou qualidade insuficiente.',
    unauthorized: 'Credenciais inválidas para o leitor.',
    serverError: 'Erro interno no leitor.',
  },
  lpr: {
    offline: 'Câmera LPR offline ou inacessível',
    bad400:
      'A câmera recusou a consulta (HTTP 400). Verifique firmware, modelo e permissões HTTP (Digest); não está relacionado a reconhecimento facial.',
    unauthorized: 'Credenciais inválidas para a câmera.',
    serverError: 'Erro interno na câmera.',
  },
} satisfies Record<IntelbrasHttpMessaging, Record<string, string>>;

/**
 * Converte erro bruto da comunicação com o leitor ou câmera (rede / HTTP CGI) em mensagem amigável.
 * Não inclui o nome do equipamento — use `formatReaderFaceSyncError` no agregador.
 */
export function mapReaderError(
  err: unknown,
  messaging: IntelbrasHttpMessaging = 'facial',
): string {
  const msgs = INTELBRAS_ERR_MSG[messaging];
  const roots = walkErrorRoots(err);

  /** Mensagens concatenadas para encaixar Axios/cause aninhadas. */
  const chainedMsgs = roots
    .flatMap((n) =>
      n instanceof Error
        ? n.message
          ? [n.message]
          : []
        : typeof n === 'string'
          ? [n]
          : [],
    )
    .join(' ')
    .trim();

  const rawMsg =
    chainedMsgs.length > 0
      ? chainedMsgs
      : err instanceof Error
        ? err.message
        : String(err);

  for (const node of roots) {
    const c = errnoCode(node);
    if (c && OFFLINE_ERRNO_CODES.has(c)) {
      return msgs.offline;
    }
  }

  const lower = rawMsg.toLowerCase();
  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('econnaborted') ||
    lower.includes('econnrefused') ||
    lower.includes('etimedout') ||
    lower.includes('ehostunreach') ||
    lower.includes('enotfound') ||
    lower.includes('enetunreach') ||
    lower.includes('network error') ||
    lower.includes('socket hang up')
  ) {
    return msgs.offline;
  }

  const http = httpStatusFromError(err);
  if (http === 400) {
    return msgs.bad400;
  }

  /** Mensagem só em inglês, sem objeto `response` na raiz útil ao type checker. */
  if (
    /\brequest failed\b/i.test(rawMsg) &&
    (/\bstatus(?:\s+code)?\D{0,5}400\b/i.test(rawMsg) || /\b400\b.*status\b/i.test(lower))
  ) {
    return msgs.bad400;
  }

  if (http === 401 || http === 403) {
    return msgs.unauthorized;
  }
  if (http !== undefined && http >= 500) {
    return msgs.serverError;
  }

  const looksTechnical =
    /(?:^|\s)e(?:connrefused|timedout|hostunreach|notfound|netunreach|connaborted)/i.test(
      lower,
    ) ||
    /\bconnect\s+[a-z]/i.test(rawMsg) ||
    /\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?/.test(rawMsg);

  if (
    looksTechnical ||
    /request failed|\baxios\b|\btimeout\b|\btimed\s+out\b/i.test(lower)
  ) {
    return msgs.offline;
  }

  if (rawMsg.length > 0) return rawMsg;
  return String(err);
}

/** Mensagem por leitor para `deviceSyncError` (ex.: fluxo FaceSyncService). */
export function formatReaderFaceSyncError(readerName: string, err: unknown): string {
  return `${readerName}: ${mapReaderError(err)}`;
}

type ApiDigestResponse = { status?: number; data?: unknown };

/** Evita pendurar a API/gateway enquanto o SO tenta TCP até ~2min em IP inalcançável. */
const READER_HTTP_TIMEOUT_MS = 10_000;

function stripDataUriBase64(raw: string): string {
  return raw.replace(/^data:image\/[a-z+]+;base64,/, '');
}

async function digestRequest(
  auth: AxiosDigestAuth,
  init: {
    method: 'GET' | 'POST';
    url: string;
    data?: Record<string, unknown>;
    headers?: Record<string, string>;
  },
): Promise<ApiDigestResponse> {
  return auth.request({
    ...init,
    timeout: READER_HTTP_TIMEOUT_MS,
  } as Parameters<AxiosDigestAuth['request']>[0]) as Promise<ApiDigestResponse>;
}

/**
 * Cria/atualiza cartão de acesso e envia a foto ao leitor Intelbras/Dahua (CGI + Digest).
 */
export async function intelbrasUpsertFaceOnReader(
  reader: PlainReaderCredential,
  faceIdNumeric: number,
  displayName: string,
  rawBase64: string,
): Promise<void> {
  const normalizedName =
    normalizeNameForFacialReader(displayName.trim() || 'USUARIO') || 'USUARIO';
  const auth = new AxiosDigestAuth({
    username: reader.username,
    password: reader.plainPassword,
  });

  const base = deviceUrl(reader);
  const faceId = String(faceIdNumeric);
  const cleanBase64 = stripDataUriBase64(rawBase64).trim();

  const decBytes = Buffer.from(cleanBase64, 'base64').length;
  if (decBytes > 100 * 1024) {
    throw new Error(
      `Arquivo muito grande (${(decBytes / 1024).toFixed(1)} KB). Limite: 100 KB`,
    );
  }

  const checkUserUrl = `${base}/cgi-bin/AccessUser.cgi?action=list&UserIDList[0]=${faceId}`;
  let userExists = false;
  try {
    const r = await digestRequest(auth, { method: 'GET', url: checkUserUrl });
    userExists = (r.status ?? 0) >= 200 && (r.status ?? 0) < 300;
  } catch {
    userExists = false;
  }

  if (!userExists) {
    const qsStart = encodeURIComponent(DEFAULT_INTELBRAS_VALID_DATE_START);
    const qsEnd = encodeURIComponent(DEFAULT_INTELBRAS_VALID_DATE_END);
    const createUserUrl =
      `${base}/cgi-bin/recordUpdater.cgi?action=insert&name=AccessControlCard` +
      `&CardName=${encodeURIComponent(normalizedName)}&CardNo=${faceId}&UserID=${faceId}&CardStatus=0&UserType=0&Authority=2&Doors=[0]&TimeSections=[255]&ValidDateStart=${qsStart}&ValidDateEnd=${qsEnd}`;
    await digestRequest(auth, { method: 'GET', url: createUserUrl });
  }

  const checkFaceUrl = `${base}/cgi-bin/FaceInfoManager.cgi?action=startFind&Condition.UserID=${faceId}`;
  let faceExists = false;
  try {
    const faceResp = await digestRequest(auth, { method: 'GET', url: checkFaceUrl });
    const payload = faceResp.data as { Total?: number } | undefined;
    if (
      payload &&
      typeof payload === 'object' &&
      payload.Total !== undefined &&
      Number(payload.Total) > 0
    ) {
      faceExists = true;
    }
  } catch {
    faceExists = false;
  }

  const action = faceExists ? 'updateMulti' : 'insertMulti';
  const faceUrl = `${base}/cgi-bin/AccessFace.cgi?action=${action}`;
  await digestRequest(auth, {
    method: 'POST',
    url: faceUrl,
    data: {
      FaceList: [{ UserID: faceId, PhotoData: [cleanBase64] }],
    },
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function intelbrasRemoveUserFromReader(
  reader: PlainReaderCredential,
  faceIdParam: number | string,
): Promise<void> {
  const auth = new AxiosDigestAuth({
    username: reader.username,
    password: reader.plainPassword,
  });
  const faceId = String(faceIdParam);
  const base = deviceUrl(reader);
  const url = `${base}/cgi-bin/AccessUser.cgi?action=removeMulti&UserIDList[0]=${faceId}`;
  await digestRequest(auth, { method: 'GET', url });
}

export type DeviceUser = {
  UserID: string;
  CardName: string;
  CardNo: string;
  ValidDateStart?: string;
  ValidDateEnd?: string;
};

export type DeviceUsersListResult = {
  found: number;
  records: DeviceUser[];
};

export async function intelbrasGetDeviceUsers(
  reader: PlainReaderCredential,
  count: number,
  offset: number,
): Promise<DeviceUsersListResult> {
  const auth = new AxiosDigestAuth({
    username: reader.username,
    password: reader.plainPassword,
  });
  const base = deviceUrl(reader);
  const url = `${base}/cgi-bin/recordFinder.cgi?action=doSeekFind&name=AccessControlCard&count=${count}&offset=${offset}`;
  const response = await digestRequest(auth, { method: 'GET', url });

  if (typeof response.data !== 'string') {
    return { found: 0, records: [] };
  }

  const text = response.data;
  let found = 0;
  const recordsMap = new Map<string, Partial<DeviceUser>>();

  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('found=')) {
      found = parseInt(trimmed.substring(6), 10) || 0;
      continue;
    }

    const match = /^records\[(\d+)\]\.(.+?)=(.*)$/.exec(trimmed);
    if (match) {
      const index = match[1];
      const key = match[2];
      const value = match[3];

      let record = recordsMap.get(index);
      if (!record) {
        record = {};
        recordsMap.set(index, record);
      }

      if (key === 'UserID') record.UserID = value;
      else if (key === 'CardName') record.CardName = value;
      else if (key === 'CardNo') record.CardNo = value;
      else if (key === 'ValidDateStart') record.ValidDateStart = value;
      else if (key === 'ValidDateEnd') record.ValidDateEnd = value;
    }
  }

  const records = Array.from(recordsMap.values()).map((r) => ({
    UserID: r.UserID || '',
    CardName: r.CardName || '',
    CardNo: r.CardNo || '',
    ValidDateStart: r.ValidDateStart,
    ValidDateEnd: r.ValidDateEnd,
  }));

  return { found, records };
}

export async function intelbrasGetFaceImage(
  reader: PlainReaderCredential,
  userId: string,
): Promise<{ photoBase64: string | null }> {
  const auth = new AxiosDigestAuth({
    username: reader.username,
    password: reader.plainPassword,
  });
  const base = deviceUrl(reader);
  const url = `${base}/cgi-bin/AccessFace.cgi?action=list&UserIDList[0]=${userId}`;
  const response = await digestRequest(auth, { method: 'GET', url });

  if (typeof response.data !== 'string') {
    return { photoBase64: null };
  }

  const text = response.data;
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Procura por FaceDataList[0].PhotoData[0]=...
    if (trimmed.includes('PhotoData[0]=')) {
      const parts = trimmed.split('=');
      if (parts.length >= 2) {
        return { photoBase64: parts[1].trim() };
      }
    }
  }

  return { photoBase64: null };
}
