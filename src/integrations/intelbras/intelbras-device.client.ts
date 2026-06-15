import AxiosDigestAuth from '@mhoc/axios-digest-auth';

import type { ReaderFaceSyncRow } from '../../database/queries/readers.queries';
import type { ShiftScheduleJson } from '../../database/schema/shifts';
import {
  DEFAULT_INTELBRAS_VALID_DATE_END,
  DEFAULT_INTELBRAS_VALID_DATE_START,
} from './intelbras-valid-date.util';
import {
  buildAccessTimeScheduleQueryString,
  buildTimeSectionsRecordUpdaterParams,
} from './intelbras-time-schedule.util';
import { normalizeNameForFacialReader } from '../../face-sync/normalize-name-for-reader';
import {
  readerLabel,
  syncLog,
  syncLogError,
  truncateForLog,
} from './intelbras-sync-debug.util';

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
  return port === 80 ? `http://${reader.ip}` : `http://${reader.ip}:${port}`;
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
      for (const err of cur.errors) {
        queue.push(err);
      }
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
      coerceHttpStatus(
        (r.response as { statusCode?: unknown } | undefined)?.statusCode,
      );
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
    (/\bstatus(?:\s+code)?\D{0,5}400\b/i.test(rawMsg) ||
      /\b400\b.*status\b/i.test(lower))
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
export function formatReaderFaceSyncError(
  readerName: string,
  err: unknown,
): string {
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
  try {
    const response = (await auth.request({
      ...init,
      timeout: READER_HTTP_TIMEOUT_MS,
    } as Parameters<AxiosDigestAuth['request']>[0])) as ApiDigestResponse;

    syncLog('digestRequest:ok', {
      method: init.method,
      url: init.url,
      status: response.status,
      dataPreview: truncateForLog(response.data),
    });

    return response;
  } catch (err) {
    syncLogError('digestRequest', err, {
      method: init.method,
      url: init.url,
      hasBody: init.data != null,
    });
    throw err;
  }
}

/**
 * Localiza RecNo do cartão AccessControlCard pelo UserID (face_id numérico).
 * Pagina o recordFinder — usuários além dos primeiros 500 também são encontrados.
 */
export async function intelbrasFindCardByUserId(
  reader: PlainReaderCredential,
  userId: string,
): Promise<DeviceUser | null> {
  const label = readerLabel(reader);
  syncLog('findCardByUserId:inicio', { reader: label, userId });

  try {
    const pageSize = 500;
    let offset = 0;
    let totalFound = Number.POSITIVE_INFINITY;

    while (offset < totalFound) {
      const { found, records, totalCount } = await intelbrasGetDeviceUsers(
        reader,
        pageSize,
        offset,
      );
      const total = totalCount > 0 ? totalCount : found;
      totalFound = total;

      const match = records.find((r) => r.UserID === userId);
      if (match?.RecNo) {
        const recNo = parseInt(match.RecNo, 10);
        if (Number.isFinite(recNo) && recNo > 0) {
          syncLog('findCardByUserId:encontrado', {
            reader: label,
            userId,
            recNo,
            cardName: match.CardName,
            timeSectionIndices: match.timeSectionIndices,
          });
          return match;
        }
      }

      if (records.length === 0) break;
      offset += records.length;
      if (offset >= total) break;
    }

    syncLog('findCardByUserId:naoEncontrado', { reader: label, userId });
    return null;
  } catch (err) {
    syncLogError('findCardByUserId', err, { reader: label, userId });
    throw err;
  }
}

/** @deprecated Use {@link intelbrasFindCardByUserId}. */
export async function intelbrasFindCardRecNo(
  reader: PlainReaderCredential,
  userId: string,
): Promise<number | null> {
  const card = await intelbrasFindCardByUserId(reader, userId);
  if (!card?.RecNo) return null;
  const recNo = parseInt(card.RecNo, 10);
  return Number.isFinite(recNo) && recNo > 0 ? recNo : null;
}

function parseAccessControlCardFinderText(text: string): DeviceUsersListResult {
  let found = 0;
  const recordsMap = new Map<string, Partial<DeviceUser>>();

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('found=')) {
      found = parseInt(trimmed.substring(6), 10) || 0;
      continue;
    }

    const match = /^records\[(\d+)\]\.(.+?)=(.*)$/.exec(trimmed);
    if (!match) continue;

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
    else if (key === 'RecNo') record.RecNo = value;
    else if (key === 'ValidDateStart') record.ValidDateStart = value;
    else if (key === 'ValidDateEnd') record.ValidDateEnd = value;
    else if (key === 'TimeSections') record.TimeSections = value;
    else if (/^TimeSections\[(\d+)\]$/.test(key)) {
      const idx = parseInt(/^TimeSections\[(\d+)\]$/.exec(key)![1], 10);
      if (!record.timeSectionIndices) record.timeSectionIndices = [];
      const zone = parseInt(value, 10);
      if (Number.isFinite(zone)) record.timeSectionIndices[idx] = zone;
    }
  }

  const records = Array.from(recordsMap.values()).map((r) => ({
    UserID: r.UserID || '',
    CardName: r.CardName || '',
    CardNo: r.CardNo || '',
    RecNo: r.RecNo,
    ValidDateStart: r.ValidDateStart,
    ValidDateEnd: r.ValidDateEnd,
    TimeSections: r.TimeSections,
    timeSectionIndices: r.timeSectionIndices,
  }));

  return { totalCount: 0, found, records };
}

/** Sincroniza uma zona AccessTimeSchedule[n] no leitor a partir do schedule interno. */
export async function intelbrasSetTimeScheduleZone(
  reader: PlainReaderCredential,
  zoneIndex: number,
  schedule: ShiftScheduleJson,
  zoneName: string,
): Promise<void> {
  const label = readerLabel(reader);
  syncLog('setTimeScheduleZone:inicio', { reader: label, zoneIndex, zoneName });

  try {
    const auth = new AxiosDigestAuth({
      username: reader.username,
      password: reader.plainPassword,
    });
    const base = deviceUrl(reader);
    const query = buildAccessTimeScheduleQueryString(
      schedule,
      zoneIndex,
      zoneName,
    );
    const url = `${base}/cgi-bin/configManager.cgi?${query}`;

    syncLog('setTimeScheduleZone:request', {
      reader: label,
      zoneIndex,
      urlPreview: truncateForLog(url),
    });

    await digestRequest(auth, { method: 'GET', url });

    syncLog('setTimeScheduleZone:ok', { reader: label, zoneIndex });
  } catch (err) {
    syncLogError('setTimeScheduleZone', err, { reader: label, zoneIndex });
    throw err;
  }
}

function buildAccessCardInsertParams(args: {
  faceId: string;
  normalizedName: string;
  timeSectionIds: number[];
  validDateStart?: string;
  validDateEnd?: string;
}): string {
  const qsStart = encodeURIComponent(
    args.validDateStart ?? DEFAULT_INTELBRAS_VALID_DATE_START,
  );
  const qsEnd = encodeURIComponent(
    args.validDateEnd ?? DEFAULT_INTELBRAS_VALID_DATE_END,
  );
  const timeSections = buildTimeSectionsRecordUpdaterParams(
    args.timeSectionIds,
  );
  const cardName = encodeURIComponent(args.normalizedName);

  return (
    `action=insert&name=AccessControlCard` +
    `&CardName=${cardName}` +
    `&CardNo=${args.faceId}` +
    `&UserID=${args.faceId}` +
    `&CardStatus=0` +
    `&CardType=0` +
    `&Doors[0]=0` +
    `&${timeSections}` +
    `&ValidDateStart=${qsStart}` +
    `&ValidDateEnd=${qsEnd}`
  );
}

/** Doc Intelbras: update usa recno (minúsculo) e não altera UserID/CardNo. */
function buildAccessCardUpdateParams(args: {
  recNo: number;
  normalizedName: string;
  timeSectionIds: number[];
  validDateStart?: string;
  validDateEnd?: string;
}): string {
  const qsStart = encodeURIComponent(
    args.validDateStart ?? DEFAULT_INTELBRAS_VALID_DATE_START,
  );
  const qsEnd = encodeURIComponent(
    args.validDateEnd ?? DEFAULT_INTELBRAS_VALID_DATE_END,
  );
  const cardName = encodeURIComponent(args.normalizedName);
  const timeSections = buildTimeSectionsRecordUpdaterParams(
    args.timeSectionIds,
  );

  return (
    `action=update&name=AccessControlCard&recno=${args.recNo}` +
    `&CardName=${cardName}` +
    `&CardStatus=0` +
    `&CardType=0` +
    `&Doors[0]=0` +
    `&${timeSections}` +
    `&ValidDateStart=${qsStart}` +
    `&ValidDateEnd=${qsEnd}`
  );
}

/**
 * Cria/atualiza cartão de acesso (nome + zonas) e envia a foto ao leitor Intelbras/Dahua.
 * Pré-requisito: AccessTimeSchedule[n] já configurada no leitor quando timeSectionIds ≠ [255]
 * (use AccessTimeZoneService.ensureZonesOnSingleReader antes desta chamada).
 */
export async function intelbrasUpsertFaceOnReader(
  reader: PlainReaderCredential,
  faceIdNumeric: number,
  displayName: string,
  rawBase64: string,
  timeSectionIds: number[] = [255],
  validDateStart?: string,
  validDateEnd?: string,
): Promise<void> {
  const label = readerLabel(reader);
  const normalizedName =
    normalizeNameForFacialReader(displayName.trim() || 'USUARIO') || 'USUARIO';
  const faceId = String(faceIdNumeric);
  const cleanBase64 = stripDataUriBase64(rawBase64).trim();
  const decBytes = Buffer.from(cleanBase64, 'base64').length;

  syncLog('upsertFace:inicio', {
    reader: label,
    faceId,
    name: normalizedName,
    timeSectionIds,
    photoKb: (decBytes / 1024).toFixed(1),
  });

  try {
    if (decBytes > 100 * 1024) {
      throw new Error(
        `Arquivo muito grande (${(decBytes / 1024).toFixed(1)} KB). Limite: 100 KB`,
      );
    }

    const auth = new AxiosDigestAuth({
      username: reader.username,
      password: reader.plainPassword,
    });
    const base = deviceUrl(reader);

    let existingCard: DeviceUser | null;
    try {
      existingCard = await intelbrasFindCardByUserId(reader, faceId);
    } catch (err) {
      syncLogError('upsertFace:findCardByUserId', err, {
        reader: label,
        faceId,
      });
      throw err;
    }

    const recNo =
      existingCard?.RecNo != null
        ? parseInt(existingCard.RecNo, 10)
        : Number.NaN;
    const hasExisting = Number.isFinite(recNo) && recNo > 0;

    const cardParams = hasExisting
      ? buildAccessCardUpdateParams({
          recNo,
          normalizedName,
          timeSectionIds,
          validDateStart,
          validDateEnd,
        })
      : buildAccessCardInsertParams({
          faceId,
          normalizedName,
          timeSectionIds,
          validDateStart,
          validDateEnd,
        });
    const cardUrl = `${base}/cgi-bin/recordUpdater.cgi?${cardParams}`;
    const cardAction = hasExisting ? 'update' : 'insert';

    syncLog('upsertFace:cardSync:inicio', {
      reader: label,
      faceId,
      cardAction,
      recNo: hasExisting ? recNo : undefined,
      cardUrl,
    });

    try {
      const cardResp = await digestRequest(auth, {
        method: 'GET',
        url: cardUrl,
      });
      syncLog('upsertFace:cardSync:ok', {
        reader: label,
        faceId,
        cardAction,
        recNo: hasExisting ? recNo : undefined,
        status: cardResp.status,
        body: truncateForLog(cardResp.data),
      });
    } catch (err) {
      syncLogError('upsertFace:cardSync', err, {
        reader: label,
        faceId,
        cardAction,
        recNo: hasExisting ? recNo : undefined,
        cardUrl,
      });
      throw attachReaderSyncStepError(err, 'cartão de acesso');
    }

    const checkFaceUrl = `${base}/cgi-bin/FaceInfoManager.cgi?action=startFind&Condition.UserID=${faceId}`;
    let faceExists = false;

    syncLog('upsertFace:checkFace:inicio', {
      reader: label,
      faceId,
      checkFaceUrl,
    });

    try {
      const faceResp = await digestRequest(auth, {
        method: 'GET',
        url: checkFaceUrl,
      });
      const payload = faceResp.data as { Total?: number } | undefined;
      if (
        payload &&
        typeof payload === 'object' &&
        payload.Total !== undefined &&
        Number(payload.Total) > 0
      ) {
        faceExists = true;
      }
      syncLog('upsertFace:checkFace:ok', {
        reader: label,
        faceId,
        faceExists,
        total: payload?.Total,
        body: truncateForLog(faceResp.data),
      });
    } catch (err) {
      syncLogError('upsertFace:checkFace', err, { reader: label, faceId });
      faceExists = false;
    }

    const action = faceExists ? 'updateMulti' : 'insertMulti';
    const faceUrl = `${base}/cgi-bin/AccessFace.cgi?action=${action}`;

    syncLog('upsertFace:faceSync:inicio', {
      reader: label,
      faceId,
      action,
      faceUrl,
    });

    try {
      const faceSyncResp = await digestRequest(auth, {
        method: 'POST',
        url: faceUrl,
        data: {
          FaceList: [{ UserID: faceId, PhotoData: [cleanBase64] }],
        },
        headers: { 'Content-Type': 'application/json' },
      });
      syncLog('upsertFace:faceSync:ok', {
        reader: label,
        faceId,
        action,
        status: faceSyncResp.status,
        body: truncateForLog(faceSyncResp.data),
      });
    } catch (err) {
      syncLogError('upsertFace:faceSync', err, {
        reader: label,
        faceId,
        action,
        faceUrl,
      });
      throw attachReaderSyncStepError(err, 'foto facial');
    }

    syncLog('upsertFace:concluido', { reader: label, faceId });
  } catch (err) {
    syncLogError('upsertFace', err, {
      reader: label,
      faceId,
      timeSectionIds,
    });
    throw err;
  }
}

function attachReaderSyncStepError(err: unknown, step: string): Error {
  const msg =
    step === 'cartão de acesso' ? mapReaderCardError(err) : mapReaderError(err);
  const wrapped = new Error(`${step}: ${msg}`);
  if (err instanceof Error) {
    wrapped.cause = err;
  }
  return wrapped;
}

/** HTTP 400 no recordUpdater — parâmetros do cartão, não foto facial. */
function mapReaderCardError(err: unknown): string {
  const http = httpStatusFromError(err);
  if (http === 400) {
    return 'Leitor recusou atualização do cartão (HTTP 400). Verifique zonas de horário e dados do usuário.';
  }
  return mapReaderError(err);
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
  RecNo?: string;
  ValidDateStart?: string;
  ValidDateEnd?: string;
  TimeSections?: string;
  timeSectionIndices?: number[];
};

export type DeviceUsersListResult = {
  totalCount: number;
  found: number;
  records: DeviceUser[];
};

const ACCESS_CONTROL_CARD_NAME = 'AccessControlCard';
const ACCESS_USER_INFO_NAME = 'AccessUserInfo';
const DEVICE_USERS_BATCH_SIZE = 500;

function parseQuerySizeFromText(text: string): number {
  for (const line of text.split('\n')) {
    const m = /^Size=(\d+)$/.exec(line.trim());
    if (m) return parseInt(m[1], 10) || 0;
  }
  return 0;
}

function resolveDeviceUsersTotalCount(
  page: DeviceUsersListResult,
  offset: number,
  sizeFromQuery: number | null,
): number {
  if (sizeFromQuery != null && sizeFromQuery > 0) return sizeFromQuery;
  if (page.totalCount > 0) return page.totalCount;
  return Math.max(page.found, offset + page.records.length);
}

function normalizeCardNameSearch(term: string): string {
  return term.trim().toUpperCase();
}

/**
 * Total de usuários/cartões via getQuerySize (quando o firmware suporta).
 */
export async function intelbrasGetDeviceUserCount(
  reader: PlainReaderCredential,
): Promise<number | null> {
  const auth = new AxiosDigestAuth({
    username: reader.username,
    password: reader.plainPassword,
  });
  const base = deviceUrl(reader);
  const url = `${base}/cgi-bin/recordFinder.cgi?action=getQuerySize&name=${ACCESS_USER_INFO_NAME}`;

  try {
    const r = await digestRequest(auth, { method: 'GET', url });
    if (typeof r.data !== 'string') return null;
    const size = parseQuerySizeFromText(r.data);
    return size > 0 ? size : null;
  } catch {
    return null;
  }
}

async function fetchDeviceUsersPage(
  reader: PlainReaderCredential,
  count: number,
  offset: number,
): Promise<DeviceUsersListResult> {
  const label = readerLabel(reader);
  const safeCount = Math.min(Math.max(count, 1), DEVICE_USERS_BATCH_SIZE);
  const safeOffset = Math.max(offset, 0);

  const auth = new AxiosDigestAuth({
    username: reader.username,
    password: reader.plainPassword,
  });
  const base = deviceUrl(reader);
  const url = `${base}/cgi-bin/recordFinder.cgi?action=doSeekFind&name=${ACCESS_CONTROL_CARD_NAME}&count=${safeCount}&offset=${safeOffset}`;

  syncLog('getDeviceUsers:inicio', {
    reader: label,
    count: safeCount,
    offset: safeOffset,
  });

  const response = await digestRequest(auth, { method: 'GET', url });
  if (typeof response.data !== 'string') {
    syncLog('getDeviceUsers:respostaNaoTexto', {
      reader: label,
      count: safeCount,
      offset: safeOffset,
      dataType: typeof response.data,
    });
    return { totalCount: 0, found: 0, records: [] };
  }

  const parsed = parseAccessControlCardFinderText(response.data);
  syncLog('getDeviceUsers:pagina', {
    reader: label,
    count: safeCount,
    offset: safeOffset,
    found: parsed.found,
    records: parsed.records.length,
  });
  return parsed;
}

async function fetchAllDeviceUsers(
  reader: PlainReaderCredential,
): Promise<DeviceUser[]> {
  const all: DeviceUser[] = [];
  let offset = 0;

  while (true) {
    const page = await fetchDeviceUsersPage(
      reader,
      DEVICE_USERS_BATCH_SIZE,
      offset,
    );
    all.push(...page.records);
    if (page.records.length < DEVICE_USERS_BATCH_SIZE) break;
    offset += DEVICE_USERS_BATCH_SIZE;
    const cap =
      page.totalCount > 0 ? page.totalCount : offset + page.records.length;
    if (offset >= cap) break;
  }

  return all;
}

export async function intelbrasGetDeviceUsers(
  reader: PlainReaderCredential,
  count: number,
  offset: number,
): Promise<DeviceUsersListResult> {
  const label = readerLabel(reader);
  const safeCount = Math.min(Math.max(count, 1), DEVICE_USERS_BATCH_SIZE);
  const safeOffset = Math.max(offset, 0);

  try {
    const [page, sizeFromQuery] = await Promise.all([
      fetchDeviceUsersPage(reader, safeCount, safeOffset),
      intelbrasGetDeviceUserCount(reader),
    ]);

    const totalCount = resolveDeviceUsersTotalCount(
      page,
      safeOffset,
      sizeFromQuery,
    );
    syncLog('getDeviceUsers:ok', {
      reader: label,
      count: safeCount,
      offset: safeOffset,
      totalCount,
      found: page.found,
      records: page.records.length,
    });
    return {
      totalCount,
      found: page.found,
      records: page.records,
    };
  } catch (err) {
    syncLogError('getDeviceUsers', err, {
      reader: label,
      count: safeCount,
      offset: safeOffset,
    });
    throw err;
  }
}

/**
 * Busca usuários por substring no CardName (sem filtro nativo no AccessControlCard).
 */
export async function intelbrasSearchDeviceUsers(
  reader: PlainReaderCredential,
  search: string,
  count: number,
  offset: number,
): Promise<DeviceUsersListResult> {
  const term = normalizeCardNameSearch(search);
  if (!term) {
    return intelbrasGetDeviceUsers(reader, count, offset);
  }

  const safeCount = Math.min(Math.max(count, 1), DEVICE_USERS_BATCH_SIZE);
  const safeOffset = Math.max(offset, 0);

  const all = await fetchAllDeviceUsers(reader);
  const filtered = all.filter((row) =>
    normalizeCardNameSearch(row.CardName).includes(term),
  );
  const slice = filtered.slice(safeOffset, safeOffset + safeCount);

  return {
    totalCount: filtered.length,
    found: slice.length,
    records: slice,
  };
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
