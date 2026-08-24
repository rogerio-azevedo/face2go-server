import type { HikvisionReaderConnection } from './hikvision-connection.types';
import {
  hikvisionIsapiRequest,
  hikvisionOpenStreamRequest,
} from './hikvision-isapi-request';

/** minor 75 = face authentication success (ISAPI AcsEvent / alertStream). */
export const HIKVISION_MINOR_FACE_AUTH_SUCCESS = 75;

/** Formato exigido pelo DS-K1T671: `2026-08-11T15:14:15-04:00` (offset local). */
export function formatHikvisionAcsEventTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export function hikvisionAlertStreamUrl(
  connection: Pick<HikvisionReaderConnection, 'baseUrl'>,
): string {
  return `${connection.baseUrl}/ISAPI/Event/notification/alertStream?format=json`;
}

export function hikvisionAcsEventSearchUrl(
  connection: Pick<HikvisionReaderConnection, 'baseUrl'>,
): string {
  return `${connection.baseUrl}/ISAPI/AccessControl/AcsEvent?format=json`;
}

export type HikvisionAccessEvent = {
  eventType: string;
  employeeNoString?: string;
  userId?: string;
  cardNo?: string;
  name?: string;
  time?: string;
  pictureURL?: string;
  status?: number;
  similarity?: number;
  major?: number;
  minor?: number;
  serialNo?: number;
  currentVerifyMode?: string;
  raw: unknown;
};

export type HikvisionAcsEventSearchOptions = {
  maxResults?: number;
  lookbackMs?: number;
  minor?: number;
  timeReverseOrder?: boolean;
  beginSerialNo?: number;
};

export function parseHikvisionAlertStreamPart(
  body: Buffer,
): HikvisionAccessEvent | null {
  const text = body.toString('utf8').trim();
  if (!text) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  return normalizeHikvisionAccessEvent(parsed, { source: 'alertStream' });
}

function pickEventNum(
  obj: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      return v;
    }
    if (typeof v === 'string' && /^\d+$/.test(v)) {
      return parseInt(v, 10);
    }
  }
  return undefined;
}

function pickEventStr(
  obj: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      return String(v).trim();
    }
  }
  return undefined;
}

function isFaceVerifyMode(mode: string | undefined): boolean {
  if (!mode) {
    return false;
  }
  const m = mode.toLowerCase();
  return m === 'face' || m.includes('face');
}

export function normalizeHikvisionAccessEvent(
  payload: unknown,
  options?: { source?: 'alertStream' | 'acsEvent' },
): HikvisionAccessEvent | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const root = payload as Record<string, unknown>;
  const nestedAlert = root.EventNotificationAlert as
    | Record<string, unknown>
    | undefined;
  const event =
    (root.AccessControllerEvent as Record<string, unknown> | undefined) ??
    (nestedAlert?.AccessControllerEvent as
      | Record<string, unknown>
      | undefined) ??
    nestedAlert ??
    root;

  const major =
    pickEventNum(event, 'major', 'Major') ??
    pickEventNum(root, 'major', 'Major');
  const minor =
    pickEventNum(event, 'minor', 'Minor') ??
    pickEventNum(root, 'minor', 'Minor');
  const serialNo =
    pickEventNum(event, 'serialNo', 'SerialNo') ??
    pickEventNum(root, 'serialNo', 'SerialNo');
  const currentVerifyMode =
    pickEventStr(event, 'currentVerifyMode', 'CurrentVerifyMode') ??
    pickEventStr(root, 'currentVerifyMode', 'CurrentVerifyMode');

  const eventType = String(
    event.eventType ??
      event.EventType ??
      root.eventType ??
      (major === 5 ? 'AccessControllerEvent' : ''),
  );

  if (
    eventType &&
    eventType !== 'AccessControllerEvent' &&
    !eventType.toLowerCase().includes('access') &&
    major !== 5
  ) {
    return null;
  }

  const employeeNoString =
    pickEventStr(event, 'employeeNoString', 'EmployeeNoString') ??
    pickEventStr(event, 'employeeNo', 'EmployeeNo') ??
    pickEventStr(event, 'userID', 'UserID') ??
    pickEventStr(root, 'employeeNoString', 'EmployeeNoString');
  if (!employeeNoString) {
    return null;
  }

  if (options?.source === 'acsEvent') {
    if (
      minor !== HIKVISION_MINOR_FACE_AUTH_SUCCESS &&
      !isFaceVerifyMode(currentVerifyMode)
    ) {
      return null;
    }
  }

  const statusRaw = event.status ?? event.Status ?? event.doorNo;
  const status =
    typeof statusRaw === 'number'
      ? statusRaw
      : typeof statusRaw === 'string' && /^\d+$/.test(statusRaw)
        ? parseInt(statusRaw, 10)
        : undefined;

  const similarityRaw = event.similarity ?? event.Similarity;
  const similarity =
    typeof similarityRaw === 'number'
      ? similarityRaw
      : typeof similarityRaw === 'string'
        ? Number(similarityRaw)
        : undefined;

  return {
    eventType: eventType || 'AccessControllerEvent',
    employeeNoString,
    userId: employeeNoString,
    cardNo: pickEventStr(event, 'cardNo', 'CardNo'),
    name: pickEventStr(event, 'name', 'Name'),
    time:
      pickEventStr(event, 'time', 'Time', 'dateTime', 'DateTime') ??
      pickEventStr(root, 'dateTime', 'DateTime'),
    pictureURL: pickEventStr(event, 'pictureURL', 'PictureURL'),
    status,
    similarity: Number.isFinite(similarity) ? similarity : undefined,
    major,
    minor,
    serialNo,
    currentVerifyMode,
    raw: payload,
  };
}

export async function hikvisionSearchAcsEvents(
  connection: HikvisionReaderConnection,
  options: HikvisionAcsEventSearchOptions = {},
): Promise<HikvisionAccessEvent[]> {
  const now = new Date();
  const lookbackMs = options.lookbackMs ?? 24 * 60 * 60 * 1000;
  const start = new Date(now.getTime() - lookbackMs);
  const maxResults = options.maxResults ?? 5;

  const acsEventCond: Record<string, unknown> = {
    searchID: `face2go-${Date.now()}`,
    searchResultPosition: 0,
    maxResults,
    major: 5,
    minor: options.minor ?? 0,
    startTime: formatHikvisionAcsEventTime(start),
    endTime: formatHikvisionAcsEventTime(now),
  };

  if (options.timeReverseOrder) {
    acsEventCond.timeReverseOrder = true;
  }
  if (options.beginSerialNo != null) {
    acsEventCond.beginSerialNo = options.beginSerialNo;
  }

  const body = { AcsEventCond: acsEventCond };

  const response = await hikvisionIsapiRequest(connection, {
    method: 'POST',
    url: hikvisionAcsEventSearchUrl(connection),
    headers: { 'Content-Type': 'application/json' },
    data: body,
  });

  const data = response.data;
  if (!data || typeof data !== 'object') {
    return [];
  }

  const root = data as Record<string, unknown>;
  const acs = root.AcsEvent as Record<string, unknown> | undefined;
  const infoList = acs?.InfoList;
  const items = Array.isArray(infoList) ? infoList : infoList ? [infoList] : [];

  const events: HikvisionAccessEvent[] = [];
  for (const item of items) {
    const normalized = normalizeHikvisionAccessEvent(
      {
        AccessControllerEvent: item,
        eventType: 'AccessControllerEvent',
      },
      { source: 'acsEvent' },
    );
    if (normalized) {
      events.push(normalized);
    }
  }
  return events;
}

/** Verifica se o leitor suporta alertStream (alguns firmwares retornam 404). */
export async function hikvisionProbeAlertStreamSupported(
  connection: HikvisionReaderConnection,
): Promise<boolean> {
  const url = hikvisionAlertStreamUrl(connection);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);

  try {
    await hikvisionOpenStreamRequest(connection, url, ac.signal);
    return true;
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } }).response?.status;
    if (status === 404) {
      return false;
    }
    if (ac.signal.aborted) {
      return false;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
}

/** Converte evento Hikvision para VideoEvent (AccessesService). */
export function hikvisionEventToVideoEvent(event: HikvisionAccessEvent): {
  code: string;
  action: string;
  index: number;
  data: Record<string, unknown>;
} {
  let createTime: number | undefined;
  if (event.time) {
    const ms = Date.parse(event.time);
    if (Number.isFinite(ms)) {
      createTime = Math.floor(ms / 1000);
    }
  }

  return {
    code: 'AccessControl',
    action: 'pulse',
    index: 0,
    data: {
      UserID: event.employeeNoString ?? event.userId,
      CardName: event.name,
      CardNo: event.cardNo,
      Status: event.status ?? 1,
      Similarity: event.similarity ?? 100,
      CreateTime: createTime,
      UTC: createTime,
      Type: event.eventType,
      SnapPath: event.pictureURL,
      RecNo: event.serialNo,
    },
  };
}
