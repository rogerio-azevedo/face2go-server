import type { SnapMultipartAccumState } from './snap-buffer-state.type';
import type { VideoEvent } from './face-listener.types';

export type { VideoEvent } from './face-listener.types';

/** Uma parte completamente lida do multipart do SnapManager. */
export type SnapMultipartCompletedPart = {
  contentType: string;
  body: Buffer;
};

const BOUNDARY_MARKER = Buffer.from('--myboundary');

function indexOfBoundary(buf: Buffer): number {
  return buf.indexOf(BOUNDARY_MARKER);
}

/** Remove prefixo até o fim da linha do boundary (`--myboundary` ou `--myboundary--`). */
function consumeBoundaryLine(buf: Buffer): Buffer | null {
  const i = indexOfBoundary(buf);
  if (i === -1) {
    return null;
  }
  let start = i + BOUNDARY_MARKER.length;
  if (buf[start] === 45 && buf[start + 1] === 45) {
    start += 2;
  }
  if (buf[start] === 13) start += 1;
  if (buf[start] === 10) start += 1;
  return buf.subarray(start);
}

function findHeadersSeparator(buf: Buffer): {
  headerLen: number;
  sepLen: number;
} | null {
  const crlf = buf.indexOf(Buffer.from('\r\n\r\n'));
  if (crlf !== -1) {
    return { headerLen: crlf, sepLen: 4 };
  }
  const lf = buf.indexOf(Buffer.from('\n\n'));
  if (lf !== -1) {
    return { headerLen: lf, sepLen: 2 };
  }
  return null;
}

function parseHeadersText(headerText: string): {
  contentType: string | null;
  contentLength: number | null;
} {
  let contentType: string | null = null;
  let contentLength: number | null = null;

  for (const line of headerText.split(/\r?\n/)) {
    const mCt = /^Content-Type:\s*(.+)$/i.exec(line);
    if (mCt) {
      contentType = mCt[1].trim().split(';')[0]?.trim() ?? null;
    }
    const mCl = /^Content-Length:\s*(\d+)\s*$/i.exec(line);
    if (mCl) {
      contentLength = parseInt(mCl[1], 10);
    }
  }
  return { contentType, contentLength };
}

/**
 * Alimenta o estado com um chunk bruto do stream e devolve partes completas.
 * Usa Content-Length no cabeçalho de cada parte (formato Intelbras).
 */
export function feedSnapMultipart(
  state: SnapMultipartAccumState,
  chunk: Buffer,
): SnapMultipartCompletedPart[] {
  state.buf = Buffer.concat([state.buf, chunk]);
  const completed: SnapMultipartCompletedPart[] = [];

  const MAX_HEADER = 64 * 1024;

  while (true) {
    if (state.phase === 'seek_boundary') {
      const after = consumeBoundaryLine(state.buf);
      if (after === null) {
        const idx = indexOfBoundary(state.buf);
        if (idx > 0) {
          state.buf = state.buf.subarray(idx);
        } else if (state.buf.length > BOUNDARY_MARKER.length) {
          const keepFrom = Math.max(
            0,
            state.buf.length - BOUNDARY_MARKER.length,
          );
          state.buf = state.buf.subarray(keepFrom);
        }
        break;
      }
      state.buf = after;
      state.phase = 'read_headers';
      state.contentType = null;
      state.contentLength = null;
      state.bodyReceived = 0;
      state.bodyParts = [];
      continue;
    }

    if (state.phase === 'read_headers') {
      const sep = findHeadersSeparator(state.buf);
      if (!sep) {
        if (state.buf.length > MAX_HEADER) {
          state.buf = state.buf.subarray(state.buf.length - MAX_HEADER);
        }
        break;
      }

      const headerText = state.buf
        .subarray(0, sep.headerLen)
        .toString('latin1');
      const { contentType, contentLength } = parseHeadersText(headerText);
      state.buf = state.buf.subarray(sep.headerLen + sep.sepLen);

      state.contentType = contentType;
      state.contentLength =
        contentLength != null && Number.isFinite(contentLength)
          ? contentLength
          : null;

      if (state.contentLength == null || state.contentLength < 0) {
        state.phase = 'seek_boundary';
        continue;
      }

      state.phase = 'read_body';
      state.bodyReceived = 0;
      state.bodyParts = [];
      continue;
    }

    if (state.phase === 'read_body') {
      const need = state.contentLength! - state.bodyReceived;
      if (need <= 0) {
        state.phase = 'seek_boundary';
        continue;
      }
      const take = Math.min(need, state.buf.length);
      if (take > 0) {
        state.bodyParts.push(state.buf.subarray(0, take));
        state.buf = state.buf.subarray(take);
        state.bodyReceived += take;
      }
      if (state.bodyReceived >= state.contentLength!) {
        const body = Buffer.concat(state.bodyParts);
        const ct = state.contentType ?? 'application/octet-stream';
        completed.push({ contentType: ct, body });
        state.phase = 'seek_boundary';
        state.bodyParts = [];
        continue;
      }
      break;
    }
  }

  return completed;
}

/** Parse do corpo text/plain do SnapManager (linhas `Events[0].Campo=valor`). */
export function parseSnapManagerTextPart(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const normalized = text.replace(/^\uFEFF/, '');
  for (const line of normalized.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === 'Heartbeat') {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq === -1) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key) {
      map.set(key, val);
    }
  }
  return map;
}

const IMG_DIM_RE =
  /^Events\[0\]\.ImageInfo\[(\d+)\]\.(Offset|Length|Width|Height|Type)$/;

export type SnapImageSliceMeta = {
  index: number;
  offset: number;
  length: number;
  width?: number;
  height?: number;
  type?: number;
};

export function collectImageSlices(
  lines: Map<string, string>,
): SnapImageSliceMeta[] {
  const byIdx = new Map<number, Partial<SnapImageSliceMeta>>();

  for (const [k, v] of lines) {
    const m = IMG_DIM_RE.exec(k);
    if (!m) {
      continue;
    }
    const idx = parseInt(m[1], 10);
    const field = m[2];
    const num = parseInt(v, 10);
    if (!Number.isFinite(idx) || !Number.isFinite(num)) {
      continue;
    }
    let row = byIdx.get(idx);
    if (!row) {
      row = { index: idx };
      byIdx.set(idx, row);
    }
    if (field === 'Offset') {
      row.offset = num;
    } else if (field === 'Length') {
      row.length = num;
    } else if (field === 'Width') {
      row.width = num;
    } else if (field === 'Height') {
      row.height = num;
    } else if (field === 'Type') {
      row.type = num;
    }
  }

  return [...byIdx.values()]
    .filter(
      (r): r is SnapImageSliceMeta =>
        r.index !== undefined &&
        r.offset !== undefined &&
        r.length !== undefined,
    )
    .sort((a, b) => a.index - b.index);
}

/**
 * Extrai o primeiro JPEG do buffer da parte imagem usando metadados ImageInfo[0], ou o buffer inteiro.
 */
export function sliceSnapJpeg(
  imageBuf: Buffer,
  slices: SnapImageSliceMeta[],
): Buffer {
  const first = slices[0];
  if (
    first &&
    first.offset >= 0 &&
    first.length > 0 &&
    first.offset + first.length <= imageBuf.length
  ) {
    return imageBuf.subarray(first.offset, first.offset + first.length);
  }
  return imageBuf;
}

/**
 * Converte mapa flat em `VideoEvent` para `AccessesService.recordSnapManagerAccess`.
 */
export function snapFlatMapToVideoEvent(
  lines: Map<string, string>,
): VideoEvent | null {
  const code =
    lines.get('Events[0].EventBaseInfo.Code') ??
    lines.get('Events[0].Code') ??
    'AccessControl';
  const action =
    lines.get('Events[0].EventBaseInfo.Action') ??
    lines.get('Events[0].Action') ??
    'Pulse';

  if (code !== 'AccessControl' && code !== '_DoorFace_') {
    return null;
  }

  const pickNum = (k: string): number | undefined => {
    const v = lines.get(k);
    if (v == null || v === '') {
      return undefined;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const pickStr = (k: string): string | undefined => {
    const v = lines.get(k);
    return v !== undefined && v !== '' ? v : undefined;
  };

  const data: Record<string, unknown> = {
    UserID:
      pickStr('Events[0].UserID') ??
      pickNum('Events[0].UserID')?.toString() ??
      undefined,
    Status: pickNum('Events[0].Status'),
    Similarity: pickNum('Events[0].Similarity'),
    CreateTime: pickNum('Events[0].CreateTime') ?? pickNum('Events[0].UTC'),
    UTC: pickNum('Events[0].UTC') ?? pickNum('Events[0].CreateTime'),
    CardName: pickStr('Events[0].CardName'),
    CardNo: pickStr('Events[0].CardNo'),
    Door: pickNum('Events[0].Door'),
    ErrorCode: pickNum('Events[0].ErrorCode'),
    Method: pickNum('Events[0].Method'),
    ReaderID:
      pickStr('Events[0].ReaderID') ??
      (pickNum('Events[0].ReaderID') !== undefined
        ? String(pickNum('Events[0].ReaderID'))
        : undefined),
    Type: pickStr('Events[0].Type'),
    SnapPath: pickStr('Events[0].SnapPath'),
  };

  if (data.UserID === undefined || data.UserID === null) {
    return null;
  }

  return {
    code,
    action,
    index: pickNum('Events[0].EventBaseInfo.Index') ?? 0,
    data,
  };
}
