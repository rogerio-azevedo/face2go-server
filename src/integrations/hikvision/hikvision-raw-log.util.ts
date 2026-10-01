const TAG = '[HikvisionRAW]';

export function isHikvisionRawLogEnabled(): boolean {
  return process.env.HIKVISION_DEBUG_RAW === '1';
}

function byteSize(data: unknown): number | null {
  if (Buffer.isBuffer(data)) return data.length;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (data instanceof Uint8Array) return data.byteLength;
  return null;
}

export function contentTypeFromHeaders(headers: unknown): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const record = headers as Record<string, unknown> & {
    get?: (name: string) => unknown;
  };
  const direct = record['Content-Type'] ?? record['content-type'];
  if (typeof direct === 'string') return direct;
  if (typeof record.get === 'function') {
    const value = record.get('content-type');
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function omitsBinary(contentType: string | undefined): boolean {
  return (
    contentType != null &&
    /multipart\/form-data|image\/|octet-stream/i.test(contentType)
  );
}

/** JSON/XML inteiros. JPEG e multipart não entram no console. */
export function previewHikvisionRawBody(
  data: unknown,
  contentType?: string,
): unknown {
  if (data === undefined) return undefined;
  const size = byteSize(data);
  if (size != null || omitsBinary(contentType)) {
    const bytes =
      size ?? (typeof data === 'string' ? Buffer.byteLength(data) : null);
    return bytes != null ? `<omitido ${bytes} bytes>` : '<omitido>';
  }
  return data;
}

export function hikvisionRawErrorView(error: unknown): {
  httpStatus?: number;
  responseData?: unknown;
} {
  if (!error || typeof error !== 'object' || !('response' in error)) {
    return {};
  }
  const response = (error as { response?: { status?: number; data?: unknown } })
    .response;
  if (!response) return {};
  return { httpStatus: response.status, responseData: response.data };
}

export function logHikvisionRaw(entry: {
  transport: 'local' | 'gateway';
  method: string;
  url: string;
  requestHeaders?: unknown;
  requestData?: unknown;
  httpStatus?: number;
  responseData?: unknown;
  responseType?: string;
}): void {
  if (!isHikvisionRawLogEnabled()) return;

  const binaryResponse =
    entry.responseType === 'stream' || entry.responseType === 'arraybuffer';
  const payload = {
    transport: entry.transport,
    method: String(entry.method || 'GET').toUpperCase(),
    url: entry.url,
    httpStatus: entry.httpStatus,
    request: previewHikvisionRawBody(
      entry.requestData,
      contentTypeFromHeaders(entry.requestHeaders),
    ),
    response: binaryResponse
      ? previewHikvisionRawBody(entry.responseData, 'application/octet-stream')
      : previewHikvisionRawBody(entry.responseData),
  };

  try {
    console.log(TAG, JSON.stringify(payload));
  } catch {
    console.log(TAG, payload.method, payload.url, payload.httpStatus);
  }
}
