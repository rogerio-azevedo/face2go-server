import {
  aggregateReaderSyncOutcome,
  isFullySyncedDevice,
  isIncompleteDeviceSync,
} from './aggregate-reader-sync-outcome.util';

describe('aggregateReaderSyncOutcome', () => {
  const rejection =
    'Portaria: Foto rejeitada pelo leitor: rosto não detectado ou qualidade insuficiente.';

  it('retorna synced sem erro quando não há falhas', () => {
    expect(aggregateReaderSyncOutcome([], 2)).toEqual({
      deviceSyncStatus: 'synced',
      deviceSyncError: null,
    });
  });

  it('inclui detalhe da falha quando um único leitor falha', () => {
    expect(aggregateReaderSyncOutcome([rejection], 1)).toEqual({
      deviceSyncStatus: 'sync_failed',
      deviceSyncError: rejection,
    });
  });

  it('inclui detalhes quando todos os leitores falham com motivos diferentes', () => {
    const other = 'Entrada: Leitor offline ou inacessível';
    const result = aggregateReaderSyncOutcome([rejection, other], 2);

    expect(result.deviceSyncStatus).toBe('sync_failed');
    expect(result.deviceSyncError).toBe(
      `Não foi possível sincronizar com 2 de 2 leitor(es). ${rejection} ${other}`,
    );
  });

  it('deduplica o motivo quando todos os leitores falham igual', () => {
    const a =
      'A1 - Saída: O leitor não conseguiu extrair o rosto da foto (qualidade insuficiente ou enquadramento).';
    const b =
      'A1 - Entrada: O leitor não conseguiu extrair o rosto da foto (qualidade insuficiente ou enquadramento).';
    const result = aggregateReaderSyncOutcome([a, b], 2);

    expect(result).toEqual({
      deviceSyncStatus: 'sync_failed',
      deviceSyncError:
        'Não foi possível sincronizar com 2 de 2 leitor(es). O leitor não conseguiu extrair o rosto da foto (qualidade insuficiente ou enquadramento). (A1 - Saída, A1 - Entrada)',
    });
  });

  it('inclui detalhes em falha parcial', () => {
    const result = aggregateReaderSyncOutcome([rejection], 2);

    expect(result).toEqual({
      deviceSyncStatus: 'synced',
      deviceSyncError: `Sincronizado parcialmente (1 de 2 leitor(es)). ${rejection}`,
    });
  });
});

describe('isIncompleteDeviceSync', () => {
  it('trata synced sem erro como completo', () => {
    expect(isIncompleteDeviceSync('synced', null)).toBe(false);
    expect(isFullySyncedDevice('synced', null)).toBe(true);
  });

  it('trata synced com erro (parcial) como incompleto', () => {
    expect(
      isIncompleteDeviceSync(
        'synced',
        'Sincronizado parcialmente (1 de 2 leitor(es)). Portaria: offline',
      ),
    ).toBe(true);
    expect(
      isFullySyncedDevice(
        'synced',
        'Sincronizado parcialmente (1 de 2 leitor(es)). Portaria: offline',
      ),
    ).toBe(false);
  });

  it('trata pending_sync e sync_failed como incompletos', () => {
    expect(isIncompleteDeviceSync('pending_sync', null)).toBe(true);
    expect(isIncompleteDeviceSync('sync_failed', 'timeout')).toBe(true);
    expect(isFullySyncedDevice('pending_sync', null)).toBe(false);
    expect(isFullySyncedDevice('sync_failed', 'timeout')).toBe(false);
  });

  it('trata status nulo como incompleto', () => {
    expect(isIncompleteDeviceSync(null, null)).toBe(true);
    expect(isFullySyncedDevice(undefined, null)).toBe(false);
  });
});
