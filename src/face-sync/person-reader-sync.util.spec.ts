import {
  isPartialSyncError,
  planPersonReaderSync,
  readerIdsCitedInSyncError,
  readerIdsToSeedAsSynced,
} from './person-reader-sync.util';
import { aggregateReaderSyncOutcome } from './aggregate-reader-sync-outcome.util';

const readers = [
  { id: 'r1', name: 'Brinquedoteca' },
  { id: 'r2', name: 'Porta Principal' },
  { id: 'r3', name: 'Escada B' },
  { id: 'r4', name: 'Sala de Jogos' },
  { id: 'r5', name: 'Portaria' },
  { id: 'r6', name: 'Garagem' },
  { id: 'r7', name: 'Piscina' },
  { id: 'r8', name: 'Hall' },
];

describe('person-reader-sync.util', () => {
  const partialError =
    'Sincronizado parcialmente (5 de 8 leitor(es)). Unauthorized (Brinquedoteca, Porta Principal, Escada B)';

  it('detecta erro parcial', () => {
    expect(isPartialSyncError(partialError)).toBe(true);
    expect(isPartialSyncError(null)).toBe(false);
    expect(isPartialSyncError('timeout')).toBe(false);
  });

  it('cita leitores pelo nome no erro', () => {
    expect(readerIdsCitedInSyncError(partialError, readers).sort()).toEqual([
      'r1',
      'r2',
      'r3',
    ]);
  });

  it('semeia synced os leitores que o erro não cita', () => {
    expect(readerIdsToSeedAsSynced(partialError, readers)?.sort()).toEqual([
      'r4',
      'r5',
      'r6',
      'r7',
      'r8',
    ]);
  });

  it('não semeia se nenhum nome casar', () => {
    expect(
      readerIdsToSeedAsSynced(
        'Sincronizado parcialmente (1 de 2 leitor(es)). Leitor Fantasma: offline',
        readers,
      ),
    ).toBeNull();
  });

  it('pula leitores já synced e tenta os outros', () => {
    const plan = planPersonReaderSync(
      readers,
      [
        { readerId: 'r1', status: 'synced' },
        { readerId: 'r2', status: 'sync_failed' },
      ],
      null,
    );
    expect(plan.skipped.map((r) => r.id)).toEqual(['r1']);
    expect(plan.toSync.map((r) => r.id)).toEqual([
      'r2',
      'r3',
      'r4',
      'r5',
      'r6',
      'r7',
      'r8',
    ]);
    expect(plan.seedSyncedIds).toEqual([]);
  });

  it('no seed, só os citados entram no lote', () => {
    const plan = planPersonReaderSync(readers, [], partialError);
    expect(plan.seedSyncedIds.sort()).toEqual(['r4', 'r5', 'r6', 'r7', 'r8']);
    expect(plan.toSync.map((r) => r.id).sort()).toEqual(['r1', 'r2', 'r3']);
    expect(plan.skipped).toHaveLength(5);
  });

  it('sem nomes casando, não pula ninguém', () => {
    const plan = planPersonReaderSync(
      readers,
      [],
      'Sincronizado parcialmente (1 de 2 leitor(es)). Leitor Fantasma: offline',
    );
    expect(plan.seedSyncedIds).toEqual([]);
    expect(plan.toSync).toHaveLength(8);
    expect(plan.skipped).toHaveLength(0);
  });

  it('7 pulados + 1 ok agrega synced sem erro', () => {
    const plan = planPersonReaderSync(
      readers.slice(0, 8),
      readers.slice(0, 7).map((r) => ({ readerId: r.id, status: 'synced' })),
      null,
    );
    expect(plan.toSync).toHaveLength(1);
    expect(aggregateReaderSyncOutcome([], readers.length)).toEqual({
      deviceSyncStatus: 'synced',
      deviceSyncError: null,
    });
  });

  it('7 pulados + 1 falha continua parcial', () => {
    const outcome = aggregateReaderSyncOutcome(
      ['Sala de Jogos: Unauthorized'],
      8,
    );
    expect(outcome.deviceSyncStatus).toBe('synced');
    expect(outcome.deviceSyncError).toContain('parcialmente');
    expect(outcome.deviceSyncError).toContain('7 de 8');
  });
});
