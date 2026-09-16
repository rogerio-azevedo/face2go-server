import {
  isHikvisionBlockListEvent,
  type HikvisionAccessEvent,
} from '../integrations/hikvision';

export const HIKVISION_ALERT_PENDING_FLUSH_MS = 800;

export type HikvisionAlertPendingEvent<T> = {
  event: T;
  image: Buffer | null;
};

export type HikvisionAlertPartKind = 'json' | 'image' | 'ignore';

export type HikvisionAlertIncoming<T> =
  { kind: 'event'; event: T } | { kind: 'image'; image: Buffer };

export function classifyHikvisionAlertPart(
  contentType: string,
  body?: Buffer,
): HikvisionAlertPartKind {
  const ct = contentType.toLowerCase();
  if (ct.includes('json') || ct.startsWith('text/')) {
    return 'json';
  }
  if (ct.startsWith('image/')) {
    return 'image';
  }
  if (body && body.length > 2 && body[0] === 0xff && body[1] === 0xd8) {
    return 'image';
  }
  return 'ignore';
}

/**
 * Casa JSON do evento com a parte image/jpeg seguinte.
 * Novo evento dá flush no pendente anterior; imagem sem pendente é ignorada.
 */
export function applyHikvisionAlertPart<T>(
  current: HikvisionAlertPendingEvent<T> | null,
  incoming: HikvisionAlertIncoming<T>,
): {
  flush: HikvisionAlertPendingEvent<T> | null;
  hold: HikvisionAlertPendingEvent<T> | null;
} {
  if (incoming.kind === 'event') {
    return {
      flush: current,
      hold: { event: incoming.event, image: null },
    };
  }

  if (!current) {
    return { flush: null, hold: null };
  }

  return {
    flush: { event: current.event, image: incoming.image },
    hold: null,
  };
}

/** Mesmo filtro de face válida que existia em handleHikvisionAccessEvent. */
export function isHikvisionAlertFaceAccess(
  event: HikvisionAccessEvent,
): boolean {
  if (!event.employeeNoString?.trim()) {
    return false;
  }
  if (isHikvisionBlockListEvent(event)) {
    return true;
  }
  const status = event.status ?? 1;
  if (status !== 1) {
    return false;
  }
  const similarity = event.similarity ?? 100;
  return Number.isFinite(similarity) && similarity > 0;
}
