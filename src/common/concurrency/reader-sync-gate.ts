import { mapWithConcurrency } from './map-with-concurrency';

/** Teto agregado de syncs de face em voo (2 vCPU). */
const GLOBAL_FACE_SYNC_LIMIT = 2;

let globalActive = 0;
const globalWaiters: Array<() => void> = [];

const readerTail = new Map<string, Promise<void>>();

async function acquireGlobalSlot(): Promise<void> {
  if (globalActive < GLOBAL_FACE_SYNC_LIMIT) {
    globalActive += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    globalWaiters.push(resolve);
  });
  globalActive += 1;
}

function releaseGlobalSlot(): void {
  globalActive = Math.max(0, globalActive - 1);
  const next = globalWaiters.shift();
  if (next) next();
}

/**
 * Garante no máximo 1 sync por leitor e limita a concorrência global.
 */
export async function withReaderSyncGate<T>(
  readerKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = readerTail.get(readerKey) ?? Promise.resolve();
  let releaseReader: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    releaseReader = resolve;
  });
  readerTail.set(
    readerKey,
    prev.then(() => current).catch(() => current),
  );

  await prev.catch(() => undefined);
  await acquireGlobalSlot();
  try {
    return await fn();
  } finally {
    releaseGlobalSlot();
    releaseReader();
    if (readerTail.get(readerKey) === current) {
      readerTail.delete(readerKey);
    }
  }
}

export async function mapReadersWithSyncGate<T, R>(
  items: readonly T[],
  readerKey: (item: T) => string,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  return mapWithConcurrency(items, GLOBAL_FACE_SYNC_LIMIT, (item) =>
    withReaderSyncGate(readerKey(item), () => fn(item)),
  );
}
