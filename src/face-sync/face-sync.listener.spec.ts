import type { DatabaseService } from '../database/database.service';
import * as readersQueries from '../database/queries/readers.queries';
import * as registrationsQueries from '../database/queries/registrations.queries';
import { FaceSyncListener } from './face-sync.listener';
import type { FaceSyncService } from './face-sync.service';

describe('FaceSyncListener age policy reconciliation', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function createListener() {
    const faceSync = {
      enqueueAgePolicyReconciliation: jest.fn().mockResolvedValue({}),
    };
    const listener = new FaceSyncListener(
      faceSync as unknown as FaceSyncService,
      { db: {} } as DatabaseService,
    );
    return { listener, faceSync };
  }

  it('enfileira a política quando ainda não foi aplicada na data civil atual', async () => {
    const { listener, faceSync } = createListener();
    jest
      .spyOn(readersQueries, 'listAgeRestrictedReadersForReconciliation')
      .mockResolvedValue([
        {
          id: 'reader-1',
          clientId: 'client-1',
          agePolicyVersion: 3,
          agePolicyStatus: 'applied',
          agePolicyAppliedAt: new Date('2026-10-06T20:00:00.000Z'),
          timezoneOffsetMinutes: -240,
        },
      ]);

    jest.useFakeTimers().setSystemTime(new Date('2026-10-07T12:00:00.000Z'));
    await (
      listener as unknown as { reconcileAgePolicies(): Promise<void> }
    ).reconcileAgePolicies();
    jest.useRealTimers();

    expect(faceSync.enqueueAgePolicyReconciliation).toHaveBeenCalledWith(
      'client-1',
      'reader-1',
      3,
    );
  });

  it('não duplica a reconciliação já aplicada hoje no fuso do cliente', async () => {
    const { listener, faceSync } = createListener();
    jest
      .spyOn(readersQueries, 'listAgeRestrictedReadersForReconciliation')
      .mockResolvedValue([
        {
          id: 'reader-1',
          clientId: 'client-1',
          agePolicyVersion: 3,
          agePolicyStatus: 'applied',
          agePolicyAppliedAt: new Date('2026-10-07T05:00:00.000Z'),
          timezoneOffsetMinutes: -240,
        },
      ]);

    jest.useFakeTimers().setSystemTime(new Date('2026-10-07T12:00:00.000Z'));
    await (
      listener as unknown as { reconcileAgePolicies(): Promise<void> }
    ).reconcileAgePolicies();
    jest.useRealTimers();

    expect(faceSync.enqueueAgePolicyReconciliation).not.toHaveBeenCalled();
  });

  it('tenta novamente uma política que falhou', async () => {
    const { listener, faceSync } = createListener();
    jest
      .spyOn(readersQueries, 'listAgeRestrictedReadersForReconciliation')
      .mockResolvedValue([
        {
          id: 'reader-1',
          clientId: 'client-1',
          agePolicyVersion: 4,
          agePolicyStatus: 'failed',
          agePolicyAppliedAt: null,
          timezoneOffsetMinutes: -240,
        },
      ]);

    await (
      listener as unknown as { reconcileAgePolicies(): Promise<void> }
    ).reconcileAgePolicies();

    expect(faceSync.enqueueAgePolicyReconciliation).toHaveBeenCalledWith(
      'client-1',
      'reader-1',
      4,
    );
  });

  it('continua reconciliando cadastros pendentes antes das políticas', async () => {
    const { listener } = createListener();
    jest
      .spyOn(registrationsQueries, 'listClientIdsWithPendingDeviceSync')
      .mockResolvedValue([]);
    jest
      .spyOn(readersQueries, 'listAgeRestrictedReadersForReconciliation')
      .mockResolvedValue([]);

    await (
      listener as unknown as { reconcilePending(): Promise<void> }
    ).reconcilePending();

    expect(
      readersQueries.listAgeRestrictedReadersForReconciliation,
    ).toHaveBeenCalled();
  });
});
