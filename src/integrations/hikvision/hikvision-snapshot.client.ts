import type { HikvisionReaderConnection } from './hikvision-connection.types';
import { hikvisionIsapiRequest } from './hikvision-isapi-request';

export function isJpegBuffer(buf: Buffer | null | undefined): buf is Buffer {
  return (
    Buffer.isBuffer(buf) && buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8
  );
}

const SNAPSHOT_TIMEOUT_MS = 8_000;
const FALLBACK_CHANNEL_IDS = [101, 1];

const snapshotChannelByOrigin = new Map<string, number>();

export function pickHikvisionSnapshotChannelId(
  payload: unknown,
): number | null {
  const ids = collectChannelIds(payload);
  if (ids.includes(101)) {
    return 101;
  }
  return ids[0] ?? null;
}

export function clearHikvisionSnapshotChannelCache(): void {
  snapshotChannelByOrigin.clear();
}

export function hikvisionSnapshotPictureUrl(
  connection: Pick<HikvisionReaderConnection, 'baseUrl'>,
  channelId: number,
): string {
  const origin = connection.baseUrl.replace(/\/$/, '');
  return `${origin}/ISAPI/Streaming/channels/${channelId}/picture?snapShotImageType=JPEG`;
}

export async function hikvisionCaptureLiveSnapshot(
  connection: HikvisionReaderConnection,
): Promise<Buffer | null> {
  const result = await hikvisionCaptureLiveSnapshotWithReason(connection);
  return result.buffer;
}

export async function hikvisionCaptureLiveSnapshotWithReason(
  connection: HikvisionReaderConnection,
): Promise<{ buffer: Buffer | null; error?: string }> {
  const channelId = await resolveSnapshotChannel(connection);
  const first = await downloadSnapshot(connection, channelId);
  if (first.buffer) {
    return first;
  }
  let lastError = first.error;
  for (const fallback of FALLBACK_CHANNEL_IDS) {
    if (fallback === channelId) {
      continue;
    }
    const alt = await downloadSnapshot(connection, fallback);
    if (alt.buffer) {
      snapshotChannelByOrigin.set(connection.baseUrl, fallback);
      return alt;
    }
    lastError = alt.error ?? lastError;
  }
  return { buffer: null, error: lastError };
}

async function resolveSnapshotChannel(
  connection: HikvisionReaderConnection,
): Promise<number> {
  const cached = snapshotChannelByOrigin.get(connection.baseUrl);
  if (cached != null) {
    return cached;
  }

  try {
    const response = await hikvisionIsapiRequest(connection, {
      method: 'GET',
      url: `${connection.baseUrl.replace(/\/$/, '')}/ISAPI/Streaming/channels`,
      timeout: SNAPSHOT_TIMEOUT_MS,
    });
    const discovered = pickHikvisionSnapshotChannelId(response.data);
    if (discovered != null) {
      snapshotChannelByOrigin.set(connection.baseUrl, discovered);
      return discovered;
    }
  } catch {
    // tenta 101 na bancada
  }

  snapshotChannelByOrigin.set(connection.baseUrl, 101);
  return 101;
}

async function downloadSnapshot(
  connection: HikvisionReaderConnection,
  channelId: number,
): Promise<{ buffer: Buffer | null; error?: string }> {
  const url = hikvisionSnapshotPictureUrl(connection, channelId);
  try {
    const response = await hikvisionIsapiRequest(connection, {
      method: 'GET',
      url,
      responseType: 'arraybuffer',
      timeout: SNAPSHOT_TIMEOUT_MS,
    });
    const jpeg = asBuffer(response.data);
    if (isJpegBuffer(jpeg)) {
      return { buffer: jpeg };
    }
    const status = response.status;
    return {
      buffer: null,
      error: `HTTP ${status} canal ${channelId} sem JPEG`,
    };
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } }).response
      ?.status;
    const message = err instanceof Error ? err.message : String(err);
    return {
      buffer: null,
      error: `canal ${channelId} HTTP ${status ?? '—'} ${message}`,
    };
  }
}

function asBuffer(raw: unknown): Buffer | null {
  if (raw instanceof Buffer) {
    return raw;
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw);
  }
  if (ArrayBuffer.isView(raw)) {
    return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  return null;
}

function collectChannelIds(payload: unknown): number[] {
  if (Buffer.isBuffer(payload) || typeof payload === 'string') {
    const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
    return uniqueIds(
      [...text.matchAll(/<id>\s*(\d+)\s*<\/id>/gi)].map((m) =>
        parseInt(m[1], 10),
      ),
    );
  }

  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const root = payload as Record<string, unknown>;
  const list =
    root.StreamingChannelList ??
    root.StreamingChannel ??
    (root as { streamingChannelList?: unknown }).streamingChannelList;
  const channels = unwrapChannels(list);
  const ids: number[] = [];
  for (const channel of channels) {
    if (!channel || typeof channel !== 'object') {
      continue;
    }
    const id =
      (channel as { id?: unknown; ID?: unknown }).id ??
      (channel as { ID?: unknown }).ID;
    const num = typeof id === 'number' ? id : Number(id);
    if (Number.isFinite(num) && num > 0) {
      ids.push(num);
    }
  }
  return uniqueIds(ids);
}

function unwrapChannels(list: unknown): unknown[] {
  if (Array.isArray(list)) {
    return list;
  }
  if (!list || typeof list !== 'object') {
    return [];
  }
  const rec = list as Record<string, unknown>;
  const nested = rec.StreamingChannel ?? rec.streamingChannel;
  if (Array.isArray(nested)) {
    return nested;
  }
  if (nested) {
    return [nested];
  }
  if ('id' in rec || 'ID' in rec) {
    return [rec];
  }
  return [];
}

function uniqueIds(ids: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ids) {
    if (!Number.isFinite(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}
