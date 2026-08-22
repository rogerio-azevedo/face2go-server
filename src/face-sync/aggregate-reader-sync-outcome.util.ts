export type ReaderSyncOutcome = {
  deviceSyncStatus: 'synced' | 'sync_failed';
  deviceSyncError: string | null;
};

/** Agrega falhas por leitor em mensagem persistida em device_sync_error. */
export function aggregateReaderSyncOutcome(
  failures: string[],
  totalReaders: number,
): ReaderSyncOutcome {
  if (failures.length === totalReaders) {
    const detail = failures.join(' ');
    const err =
      totalReaders === 1
        ? detail
        : `Não foi possível sincronizar com ${failures.length} de ${totalReaders} leitor(es). ${detail}`;
    return { deviceSyncStatus: 'sync_failed', deviceSyncError: err };
  }

  if (failures.length > 0) {
    return {
      deviceSyncStatus: 'synced',
      deviceSyncError: `Sincronizado parcialmente (${totalReaders - failures.length} de ${totalReaders} leitor(es)). ${failures.join(' ')}`,
    };
  }

  return { deviceSyncStatus: 'synced', deviceSyncError: null };
}
