export function isPartialSyncError(error: string | null | undefined): boolean {
  return error?.toLowerCase().includes('parcialmente') ?? false;
}

export function readerIdsCitedInSyncError(
  error: string,
  readers: { id: string; name: string }[],
): string[] {
  const cited: string[] = [];
  const sorted = [...readers].sort((a, b) => b.name.length - a.name.length);
  for (const reader of sorted) {
    if (reader.name.length > 0 && error.includes(reader.name)) {
      cited.push(reader.id);
    }
  }
  return cited;
}

/** Leitores ativos que o erro parcial não cita — já deram certo. `null` se nenhum nome casar. */
export function readerIdsToSeedAsSynced(
  error: string,
  readers: { id: string; name: string }[],
): string[] | null {
  const cited = new Set(readerIdsCitedInSyncError(error, readers));
  if (cited.size === 0) return null;
  return readers.filter((reader) => !cited.has(reader.id)).map((reader) => reader.id);
}

export type PersonReaderSyncPlan<T extends { id: string; name: string }> = {
  toSync: T[];
  skipped: T[];
  seedSyncedIds: string[];
};

export function planPersonReaderSync<T extends { id: string; name: string }>(
  readers: T[],
  existing: { readerId: string; status: string | null }[],
  previousError: string | null | undefined,
): PersonReaderSyncPlan<T> {
  const byReader = new Map(existing.map((row) => [row.readerId, row]));
  let seedSyncedIds: string[] = [];

  if (existing.length === 0 && isPartialSyncError(previousError) && previousError) {
    const seeded = readerIdsToSeedAsSynced(previousError, readers);
    if (seeded) {
      seedSyncedIds = seeded;
      for (const id of seeded) {
        byReader.set(id, { readerId: id, status: 'synced' });
      }
    }
  }

  const toSync: T[] = [];
  const skipped: T[] = [];
  for (const reader of readers) {
    if (byReader.get(reader.id)?.status === 'synced') skipped.push(reader);
    else toSync.push(reader);
  }

  return { toSync, skipped, seedSyncedIds };
}
