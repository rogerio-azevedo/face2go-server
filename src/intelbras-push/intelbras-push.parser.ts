export type IntelbrasAccessData = {
  CardName?: string;
  CardNo?: string;
  CardType?: number;
  CreateTime?: number;
  Door?: number;
  ErrorCode?: number;
  Method?: number;
  ReaderID?: string | number;
  Status?: number;
  Similarity?: number;
  Type?: string;
  UTC?: number;
  UserID?: string | number;
  UserType?: number;
  FaceIndex?: number;
  FeatureId?: number;
  SnapPath?: string;
  partSequence?: number;
  recNo?: number;
};

export type IntelbrasPushEvent = {
  code: string;
  action?: string;
  serial?: string;
  mac?: string;
  data: IntelbrasAccessData;
};

export type IntelbrasPushIdentity = {
  serial?: string;
  mac?: string;
  codes: string[];
  channel?: number;
};

export type IntelbrasPushParseResult = {
  format: 'json' | 'multipart';
  events: IntelbrasPushEvent[];
  identity: IntelbrasPushIdentity;
  jpeg: Buffer | null;
};

const BOUNDARY = Buffer.from('--myboundary');

function partInfoSequence(data: Record<string, unknown>): number | undefined {
  const pi = data.PartInfo;
  if (!pi || typeof pi !== 'object') {
    return undefined;
  }
  const seq = (pi as { Sequence?: unknown }).Sequence;
  return typeof seq === 'number' ? seq : undefined;
}

export function mapIntelbrasAccessData(
  data: Record<string, unknown>,
): IntelbrasAccessData {
  const readerIDRaw =
    data.ReaderID != null
      ? data.ReaderID
      : data.readID != null
        ? data.readID
        : undefined;

  const recNoRaw = data.RecNo;
  const recNo = typeof recNoRaw === 'number' ? recNoRaw : undefined;
  const status = data.Status as number | undefined;
  const similarity = data.Similarity as number | undefined;

  return {
    CardName: data.CardName as string | undefined,
    CardNo:
      data.CardNo != null &&
      (typeof data.CardNo === 'string' || typeof data.CardNo === 'number')
        ? String(data.CardNo)
        : undefined,
    CardType: data.CardType as number | undefined,
    CreateTime:
      (data.CreateTime as number | undefined) ??
      (data.RealUTC as number | undefined),
    Door: data.Door as number | undefined,
    ErrorCode: data.ErrorCode as number | undefined,
    Method:
      (data.Method as number | undefined) ??
      (data.OpenDoorMethod as number | undefined),
    ReaderID: readerIDRaw as string | number | undefined,
    Status: status,
    Similarity: similarity ?? (status === 1 ? 100 : undefined),
    Type: data.Type as string | undefined,
    UTC:
      (data.UTC as number | undefined) ?? (data.RealUTC as number | undefined),
    UserID: data.UserID as string | number | undefined,
    UserType: data.UserType as number | undefined,
    FaceIndex: data.FaceIndex as number | undefined,
    FeatureId: data.FeatureId as number | undefined,
    SnapPath: data.SnapPath as string | undefined,
    partSequence: partInfoSequence(data),
    recNo,
  };
}

function isAccessCode(code: string): boolean {
  return code === 'AccessControl' || code === '_DoorFace_';
}

function isTrackedCode(code: string): boolean {
  return isAccessCode(code) || code === 'DoorStatus';
}

export function doorStatusToOpen(
  status: unknown,
  action?: unknown,
): boolean | undefined {
  if (status === 1 || status === '1') {
    return true;
  }
  if (status === 0 || status === '0') {
    return false;
  }
  const fromStatus = normalizeDoorText(status);
  if (fromStatus !== undefined) {
    return fromStatus;
  }
  return normalizeDoorText(action);
}

function normalizeDoorText(value: unknown): boolean | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  const text = String(value).trim().toLowerCase();
  if (
    text === 'open' ||
    text === 'opened' ||
    text === 'start' ||
    text === 'aberta'
  ) {
    return true;
  }
  if (
    text === 'close' ||
    text === 'closed' ||
    text === 'stop' ||
    text === 'fechada'
  ) {
    return false;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as Record<string, unknown>;
}

function pickTrimmed(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function pickMac(rec: Record<string, unknown>): string | undefined {
  return pickTrimmed(
    rec.PhysicalAddress,
    rec.physicalAddress,
    rec.Mac,
    rec.MAC,
    rec.MacAddress,
    rec.mac,
  );
}

function pickSerial(rec: Record<string, unknown>): string | undefined {
  return pickTrimmed(rec.SN, rec.Sn, rec.sn, rec.SerialNumber);
}

export function extractIntelbrasPushIdentity(
  payload: unknown,
): IntelbrasPushIdentity {
  const root = asRecord(payload);
  if (!root) {
    return { codes: [] };
  }

  const codes: string[] = [];
  let serial: string | undefined;
  let mac: string | undefined;
  const channel = typeof root.Channel === 'number' ? root.Channel : undefined;

  const events = root.Events;
  if (Array.isArray(events)) {
    for (const ev of events) {
      const rec = asRecord(ev);
      if (!rec) {
        continue;
      }
      if (
        rec.Code != null &&
        (typeof rec.Code === 'string' || typeof rec.Code === 'number') &&
        String(rec.Code)
      ) {
        codes.push(String(rec.Code));
      }
      mac ??= pickMac(rec);
      const data = asRecord(rec.Data);
      if (data) {
        serial ??= pickSerial(data);
        mac ??= pickMac(data);
      }
    }
  }

  return {
    serial,
    mac,
    codes: [...new Set(codes)],
    channel,
  };
}

function eventsFromPayload(payload: unknown): IntelbrasPushEvent[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  const events = (payload as { Events?: unknown }).Events;
  if (!Array.isArray(events)) {
    return [];
  }

  const result: IntelbrasPushEvent[] = [];
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') {
      continue;
    }
    const rec = ev as Record<string, unknown>;
    const code =
      typeof rec.Code === 'string' || typeof rec.Code === 'number'
        ? String(rec.Code)
        : '';
    if (!isTrackedCode(code)) {
      continue;
    }
    const dataRaw = rec.Data;
    if (!dataRaw || typeof dataRaw !== 'object') {
      continue;
    }
    const dataObj = dataRaw as Record<string, unknown>;
    result.push({
      code,
      action:
        typeof rec.Action === 'string' || typeof rec.Action === 'number'
          ? String(rec.Action)
          : undefined,
      serial: pickSerial(dataObj),
      mac: pickMac(rec) ?? pickMac(dataObj),
      data: mapIntelbrasAccessData(dataObj),
    });
  }
  return result;
}

function extractPartsFromMultipart(raw: Buffer): {
  jsonText: string | null;
  jpeg: Buffer | null;
} {
  let jsonText: string | null = null;
  let jpeg: Buffer | null = null;
  let cursor = 0;
  while (cursor < raw.length) {
    const start = raw.indexOf(BOUNDARY, cursor);
    if (start === -1) {
      break;
    }
    let partStart = start + BOUNDARY.length;
    if (raw[partStart] === 45 && raw[partStart + 1] === 45) {
      break;
    }
    if (raw[partStart] === 13) partStart += 1;
    if (raw[partStart] === 10) partStart += 1;

    const next = raw.indexOf(BOUNDARY, partStart);
    const part = raw.subarray(partStart, next === -1 ? raw.length : next);
    cursor = next === -1 ? raw.length : next;

    const sep = part.indexOf(Buffer.from('\r\n\r\n'));
    const sepLen = sep !== -1 ? 4 : 0;
    const headerEnd = sep !== -1 ? sep : part.indexOf(Buffer.from('\n\n'));
    const headerSep = sep !== -1 ? sepLen : headerEnd !== -1 ? 2 : 0;
    if (headerEnd === -1) {
      continue;
    }

    const headers = part
      .subarray(0, headerEnd)
      .toString('latin1')
      .toLowerCase();
    let body = part.subarray(headerEnd + headerSep);
    if (body.length >= 2 && body[body.length - 2] === 13) {
      body = body.subarray(0, body.length - 2);
    } else if (body.length >= 1 && body[body.length - 1] === 10) {
      body = body.subarray(0, body.length - 1);
    }

    if (headers.includes('image/') && body.length > 0) {
      jpeg = Buffer.from(body);
      continue;
    }
    if (
      !headers.includes('application/json') &&
      !headers.includes('text/plain')
    ) {
      continue;
    }
    const text = body.toString('utf8').trim();
    if (text.startsWith('{')) {
      jsonText = text;
    }
  }
  return { jsonText, jpeg };
}

function parseResult(
  format: IntelbrasPushParseResult['format'],
  payload: unknown,
  jpeg: Buffer | null,
): IntelbrasPushParseResult {
  return {
    format,
    events: eventsFromPayload(payload),
    identity: extractIntelbrasPushIdentity(payload),
    jpeg,
  };
}

export function parseIntelbrasPushBody(
  contentType: string | undefined,
  raw: Buffer,
): IntelbrasPushParseResult {
  const trimmed = raw.toString('utf8').trimStart();
  if (trimmed.startsWith('{')) {
    return parseResult('json', JSON.parse(trimmed), null);
  }

  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('multipart') || raw.includes(BOUNDARY)) {
    const { jsonText, jpeg } = extractPartsFromMultipart(raw);
    if (!jsonText) {
      return { format: 'multipart', events: [], identity: { codes: [] }, jpeg };
    }
    return parseResult('multipart', JSON.parse(jsonText), jpeg);
  }

  throw new Error('payload Intelbras não reconhecido');
}
