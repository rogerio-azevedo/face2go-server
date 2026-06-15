/** Payload `data={...}` do snapManager para eventos faciais (Intelbras). */
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
    CardNo:
      typeof data.CardNo === 'string' || typeof data.CardNo === 'number'
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
    Status: data.Status as number | undefined,
    Similarity: data.Similarity as number | undefined,
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
  return `s:${readerId}:${uid}:${t}:m:${data.Method ?? ''}`;
}

/** Chave estável para upsert/idempotência (Start + Pulse do mesmo acesso físico). */
export function buildFacialCorrelationId(
  readerId: string,
  data: AccessControlEventData,
): string | null {
  const uid = String(data.UserID ?? '');
  if (data.recNo != null) {
    return `${readerId}|rec:${data.recNo}`;
  }
  const t = data.CreateTime ?? data.UTC;
  if (t && uid) {
    return `${readerId}|u:${uid}|t:${t}`;
  }
  return null;
}
