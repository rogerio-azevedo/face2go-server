/** Payload `data={...}` do eventManager para eventos faciais (Intelbras). */
export interface AccessControlEventData {
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
}

function partInfoSequence(data: Record<string, unknown>): number | undefined {
  const pi = data.PartInfo;
  if (!pi || typeof pi !== 'object') {
    return undefined;
  }
  const seq = (pi as { Sequence?: unknown }).Sequence;
  return typeof seq === 'number' ? seq : undefined;
}

function pickTrimmedString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

/**
 * Extrai URL ou caminho da captura do payload do evento (nomes variam por firmware Intelbras/Dahua).
 */
export function extractSnapshotPathFromPayload(
  data: Record<string, unknown>,
): string | null {
  const directKeys = [
    'SnapPath',
    'snapPath',
    'PictureURL',
    'PictureUrl',
    'pictureURL',
    'pictureUrl',
    'FacePicURL',
    'FacePictureURL',
    'FaceSnapPath',
    'SnapURL',
    'snapURL',
    'FaceImagePath',
    'FaceImageURL',
    'CapturePicPath',
    'ImagePath',
    'FacePicturePath',
    'BackgroundImage',
    'FaceBackgroundImage',
  ];

  for (const k of directKeys) {
    const s = pickTrimmedString(data[k]);
    if (s) return s;
  }

  const nestedContainers = [
    'Picture',
    'FacePictureInfo',
    'SnapInfo',
    'FaceSnap',
    'FaceImage',
    'FacePicture',
  ];
  const nestedKeys = [
    'URL',
    'Url',
    'url',
    'FilePath',
    'filePath',
    'Path',
    'path',
    'SnapPath',
    'Address',
    'File',
  ];

  for (const c of nestedContainers) {
    const obj = data[c];
    if (!obj || typeof obj !== 'object') continue;
    const rec = obj as Record<string, unknown>;
    for (const nk of nestedKeys) {
      const s = pickTrimmedString(rec[nk]);
      if (s) return s;
    }
  }

  return null;
}

/** Caminho relativo do leitor → URL HTTP consumível pelo proxy (`http://host:port/...`). */
export function absolutizeReaderSnapshotPath(
  pathOrUrl: string,
  readerHost: string | undefined,
): string {
  const t = pathOrUrl.trim();
  if (!t || /^https?:\/\//i.test(t)) {
    return t;
  }
  const h = readerHost?.trim();
  if (!h) {
    return t;
  }
  if (t.startsWith('/')) {
    return `http://${h}${t}`;
  }
  return `http://${h}/${t}`;
}

export function accessControlDataFromRecord(
  data: Record<string, unknown>,
): AccessControlEventData {
  const readerIDRaw =
    data.ReaderID != null
      ? data.ReaderID
      : data.readID != null
        ? data.readID
        : undefined;

  const recNoRaw = data.RecNo;
  const recNo = typeof recNoRaw === 'number' ? recNoRaw : undefined;

  return {
    CardName: data.CardName as string | undefined,
    CardNo: data.CardNo != null ? String(data.CardNo) : undefined,
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
    Status: data.Status as number | undefined,
    Similarity: data.Similarity as number | undefined,
    Type: data.Type as string | undefined,
    UTC:
      (data.UTC as number | undefined) ??
      (data.RealUTC as number | undefined),
    UserID: data.UserID as string | number | undefined,
    UserType: data.UserType as number | undefined,
    FaceIndex: data.FaceIndex as number | undefined,
    FeatureId: data.FeatureId as number | undefined,
    SnapPath:
      extractSnapshotPathFromPayload(data) ??
      pickTrimmedString(data.SnapPath) ??
      undefined,
    partSequence: partInfoSequence(data),
    recNo,
  };
}

/** Intelbras costuma enviar UTC em segundos (Unix). Alguns campos podem vir em ms. */
export function dateFromIntelbrasUtc(
  secondsOrMs: number | undefined | null,
): Date | undefined {
  if (secondsOrMs == null || !Number.isFinite(secondsOrMs)) {
    return undefined;
  }
  const n = Number(secondsOrMs);
  const ms = n < 1e12 ? n * 1000 : n;
  return new Date(ms);
}

/**
 * Idempotência do stream: um acesso físico gera vários códigos;
 * usa device + instante + usuário + contador do leitor.
 */
export function getStreamEventDedupKey(
  readerId: string,
  data: AccessControlEventData,
): string | null {
  const uid = String(data.UserID);
  const t = data.CreateTime ?? data.UTC;
  if (!t) {
    return null;
  }
  if (data.partSequence != null) {
    return `s:${readerId}:${uid}:${t}:seq:${data.partSequence}`;
  }
  if (data.recNo != null) {
    return `s:${readerId}:${uid}:${t}:rec:${data.recNo}`;
  }
  return `s:${readerId}:${uid}:${t}:m:${data.Method ?? ''}:sim:${data.Similarity ?? ''}`;
}
