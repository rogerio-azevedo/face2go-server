import { aggregateReaderSyncOutcome } from './aggregate-reader-sync-outcome.util';

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

  it('inclui detalhes quando todos os leitores falham', () => {
    const other = 'Entrada: Leitor offline ou inacessível';
    const result = aggregateReaderSyncOutcome([rejection, other], 2);

    expect(result.deviceSyncStatus).toBe('sync_failed');
    expect(result.deviceSyncError).toBe(
      `Não foi possível sincronizar com 2 de 2 leitor(es). ${rejection} ${other}`,
    );
  });

  it('inclui detalhes em falha parcial', () => {
    const result = aggregateReaderSyncOutcome([rejection], 2);

    expect(result).toEqual({
      deviceSyncStatus: 'synced',
      deviceSyncError: `Sincronizado parcialmente (1 de 2 leitor(es)). ${rejection}`,
    });
  });
});
