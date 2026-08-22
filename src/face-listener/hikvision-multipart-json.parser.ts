/** Fases do parser multipart genérico (alertStream Hikvision). */
export type MultipartPhase = 'seek_boundary' | 'read_headers' | 'read_body';

export type MultipartCompletedPart = {
  contentType: string;
  body: Buffer;
};

export type MultipartAccumState = {
  phase: MultipartPhase;
  buf: Buffer;
  contentType: string | null;
  contentLength: number | null;
  bodyReceived: number;
  bodyParts: Buffer[];
  boundaryMarker: Buffer;
};

export function createMultipartState(boundary: string): MultipartAccumState {
  const normalized = boundary.replace(/^--/, '');
  return {
    phase: 'seek_boundary',
    buf: Buffer.alloc(0),
    contentType: null,
    contentLength: null,
    bodyReceived: 0,
    bodyParts: [],
    boundaryMarker: Buffer.from(`--${normalized}`),
  };
}

function indexOfBoundary(buf: Buffer, marker: Buffer): number {
  return buf.indexOf(marker);
}

function consumeBoundaryLine(buf: Buffer, marker: Buffer): Buffer | null {
  const i = indexOfBoundary(buf, marker);
  if (i === -1) {
    return null;
  }
  let start = i + marker.length;
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

export function feedMultipartStream(
  state: MultipartAccumState,
  chunk: Buffer,
): MultipartCompletedPart[] {
  state.buf = Buffer.concat([state.buf, chunk]);
  const completed: MultipartCompletedPart[] = [];
  const marker = state.boundaryMarker;
  const MAX_HEADER = 64 * 1024;

  while (true) {
    if (state.phase === 'seek_boundary') {
      const after = consumeBoundaryLine(state.buf, marker);
      if (after === null) {
        const idx = indexOfBoundary(state.buf, marker);
        if (idx > 0) {
          state.buf = state.buf.subarray(idx);
        } else if (state.buf.length > marker.length) {
          const keepFrom = Math.max(0, state.buf.length - marker.length);
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

export function extractBoundaryFromContentType(
  contentType: string | undefined,
): string {
  if (!contentType) {
    return 'myboundary';
  }
  const m = /boundary=([^;\s"']+)/i.exec(contentType);
  if (m?.[1]) {
    return m[1].replace(/^["']|["']$/g, '');
  }
  return 'myboundary';
}
