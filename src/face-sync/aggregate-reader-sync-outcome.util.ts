export type ReaderSyncOutcome = {
  deviceSyncStatus: 'synced' | 'sync_failed';
  deviceSyncError: string | null;
};

function splitReaderFailure(failure: string): { name: string; reason: string } {
  const idx = failure.indexOf(': ');
  if (idx === -1) return { name: failure, reason: failure };
  return {
    name: failure.slice(0, idx),
    reason: failure.slice(idx + 2),
  };
}

function formatFailureDetail(failures: string[]): string {
  if (failures.length <= 1) return failures.join(' ');

  const parsed = failures.map(splitReaderFailure);
  const reasons = new Set(parsed.map((p) => p.reason));
  if (reasons.size === 1) {
    const reason = parsed[0]?.reason ?? '';
    const names = parsed.map((p) => p.name).join(', ');
    return `${reason} (${names})`;
  }
  return failures.join(' ');
}

/** Agrega falhas por leitor em mensagem persistida em device_sync_error. */
export function aggregateReaderSyncOutcome(
  failures: string[],
  totalReaders: number,
): ReaderSyncOutcome {
  if (failures.length === totalReaders) {
    const detail = formatFailureDetail(failures);
    const err =
      totalReaders === 1
        ? detail
        : `Não foi possível sincronizar com ${failures.length} de ${totalReaders} leitor(es). ${detail}`;
    return { deviceSyncStatus: 'sync_failed', deviceSyncError: err };
  }

  if (failures.length > 0) {
    return {
      deviceSyncStatus: 'synced',
      deviceSyncError: `Sincronizado parcialmente (${totalReaders - failures.length} de ${totalReaders} leitor(es)). ${formatFailureDetail(failures)}`,
    };
  }

  return { deviceSyncStatus: 'synced', deviceSyncError: null };
}
