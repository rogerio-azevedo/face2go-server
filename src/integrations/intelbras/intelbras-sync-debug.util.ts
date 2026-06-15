/** Logs de diagnóstico do sync Intelbras — grep `[FaceSync]` no terminal. */
const TAG = '[FaceSync]';

export function syncLog(step: string, details?: Record<string, unknown>): void {
  if (details !== undefined) {
    console.log(TAG, step, details);
  } else {
    console.log(TAG, step);
  }
}

export function syncLogError(
  step: string,
  err: unknown,
  details?: Record<string, unknown>,
): void {
  console.error(TAG, step, 'ERRO', {
    ...details,
    message: err instanceof Error ? err.message : String(err),
    http: extractHttpError(err),
  });
}

function extractHttpError(err: unknown): Record<string, unknown> | undefined {
  let node: unknown = err;
  for (let i = 0; i < 6 && node; i++) {
    if (node && typeof node === 'object' && 'response' in node) {
      const resp = (node as { response?: { status?: number; data?: unknown } })
        .response;
      if (resp) {
        return {
          status: resp.status,
          data: truncateForLog(resp.data),
        };
      }
    }
    node =
      node instanceof Error && 'cause' in node
        ? (node as Error & { cause?: unknown }).cause
        : undefined;
  }
  return undefined;
}

export function truncateForLog(data: unknown, max = 600): unknown {
  if (typeof data === 'string') {
    return data.length > max
      ? `${data.slice(0, max)}…(${data.length} chars)`
      : data;
  }
  if (Buffer.isBuffer(data)) {
    return `<Buffer ${data.length} bytes>`;
  }
  return data;
}

export function readerLabel(reader: {
  name: string;
  ip: string;
  port?: number;
}): string {
  return `${reader.name}@${reader.ip}:${reader.port ?? 80}`;
}
