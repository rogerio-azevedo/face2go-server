import * as registrationsQueries from '../database/queries/registrations.queries';
import type { DeviceSyncJobRow } from '../database/schema/device-sync-jobs';
import { DeviceSyncJobHandlersService } from './device-sync-job-handlers.service';

describe('DeviceSyncJobHandlersService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('não reenvia ao leitor um cadastro rejeitado por um job antigo', async () => {
    const queue = { update: jest.fn().mockResolvedValue(undefined) };
    const faceSync = { syncPersonOnReaders: jest.fn() };
    const r2 = { getObjectBytes: jest.fn() };
    const database = { db: {} };
    jest
      .spyOn(registrationsQueries, 'getRegistrationByIdForClient')
      .mockResolvedValue({
        id: 'reg-1',
        clientId: 'client-1',
        status: 'rejected',
        isActive: true,
        faceId: 12,
      } as never);
    const handler = new DeviceSyncJobHandlersService(
      queue as never,
      faceSync as never,
      {} as never,
      {} as never,
      {} as never,
      r2 as never,
      database as never,
      {} as never,
    );
    const job = {
      id: 'job-1',
      kind: 'face.person',
      clientId: 'client-1',
      targetId: 'reg-1',
      payload: {
        entityKind: 'registration',
        faceId: 12,
        photoKey: 'photo.jpg',
      },
    } as DeviceSyncJobRow;

    await handler.run(job, { checkpoint: () => Promise.resolve() });

    expect(queue.update).toHaveBeenCalledWith('job-1', {
      processed: 1,
      total: 1,
    });
    expect(r2.getObjectBytes).not.toHaveBeenCalled();
    expect(faceSync.syncPersonOnReaders).not.toHaveBeenCalled();
  });

  it('não reenvia um cadastro excluído por um job individual antigo', async () => {
    const queue = { update: jest.fn().mockResolvedValue(undefined) };
    const faceSync = { syncPersonOnReaders: jest.fn() };
    const r2 = { getObjectBytes: jest.fn() };
    jest
      .spyOn(registrationsQueries, 'getRegistrationByIdForClient')
      .mockResolvedValue({
        id: 'reg-1',
        clientId: 'client-1',
        status: 'approved',
        isActive: false,
        faceId: 12,
      } as never);
    const handler = new DeviceSyncJobHandlersService(
      queue as never,
      faceSync as never,
      {} as never,
      {} as never,
      {} as never,
      r2 as never,
      { db: {} } as never,
    );
    const job = {
      id: 'job-1',
      kind: 'face.person',
      clientId: 'client-1',
      targetId: 'reg-1',
      payload: {
        entityKind: 'registration',
        faceId: 12,
        photoKey: 'photo.jpg',
      },
    } as DeviceSyncJobRow;

    await handler.run(job, { checkpoint: () => Promise.resolve() });

    expect(queue.update).toHaveBeenCalledWith('job-1', {
      processed: 1,
      total: 1,
    });
    expect(r2.getObjectBytes).not.toHaveBeenCalled();
    expect(faceSync.syncPersonOnReaders).not.toHaveBeenCalled();
  });

  it('pula cadastro excluído após montar a lista de reconstrução', async () => {
    const queue = { update: jest.fn().mockResolvedValue(undefined) };
    const faceSync = {
      purgeIneligibleFacesFromReader: jest.fn().mockResolvedValue(0),
      syncPersonOnReaders: jest.fn(),
    };
    const rebuild = {
      listPeopleToSync: jest.fn().mockResolvedValue([
        {
          id: 'reg-1',
          name: 'Lucas',
          faceId: 351,
          photoKey: 'photo.jpg',
          entityKind: 'registration',
          timeSectionIds: [],
        },
      ]),
    };
    const r2 = { getObjectBytes: jest.fn() };
    jest
      .spyOn(registrationsQueries, 'getRegistrationByIdForClient')
      .mockResolvedValue({
        id: 'reg-1',
        clientId: 'client-1',
        status: 'approved',
        isActive: false,
        faceId: 351,
        faceImageKey: 'photo.jpg',
      } as never);
    const handler = new DeviceSyncJobHandlersService(
      queue as never,
      faceSync as never,
      rebuild as never,
      {} as never,
      {} as never,
      r2 as never,
      { db: {} } as never,
    );
    const job = {
      id: 'job-1',
      kind: 'face.reader',
      clientId: 'client-1',
      targetId: 'reader-1',
      force: false,
      processed: 0,
      payload: {},
    } as DeviceSyncJobRow;

    await handler.run(job, { checkpoint: () => Promise.resolve() });

    expect(queue.update).toHaveBeenLastCalledWith('job-1', {
      processed: 1,
      total: 1,
    });
    expect(r2.getObjectBytes).not.toHaveBeenCalled();
    expect(faceSync.syncPersonOnReaders).not.toHaveBeenCalled();
  });

  it('reenvia uma vez quando a primeira sincronização falha', async () => {
    const failed = {
      deviceSyncStatus: 'sync_failed' as const,
      deviceSyncError:
        'Não foi possível sincronizar com 9 de 9 leitor(es). timeout',
    };
    const synced = {
      deviceSyncStatus: 'synced' as const,
      deviceSyncError: null,
    };
    const faceSync = {
      syncPersonOnReaders: jest
        .fn()
        .mockResolvedValueOnce(failed)
        .mockResolvedValueOnce(synced),
      takePersistHook: jest.fn().mockReturnValue(undefined),
    };
    const persist = {
      persistFacePerson: jest.fn().mockResolvedValue(undefined),
    };
    const handler = facePersonHandler(faceSync, persist);
    const job = facePersonJob();

    jest.useFakeTimers();
    try {
      const pending = handler.run(job, {
        checkpoint: () => Promise.resolve(),
      });
      await jest.advanceTimersByTimeAsync(3_000);
      await pending;
    } finally {
      jest.useRealTimers();
    }

    expect(faceSync.syncPersonOnReaders).toHaveBeenCalledTimes(2);
    expect(faceSync.syncPersonOnReaders).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ resetReaderProgress: true }),
    );
    expect(faceSync.syncPersonOnReaders).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        resetReaderProgress: false,
        previousDeviceSyncError: failed.deviceSyncError,
      }),
    );
    expect(persist.persistFacePerson).toHaveBeenCalledWith(
      'client-1',
      'resp-1',
      expect.objectContaining({ entityKind: 'responsible', faceId: 12 }),
      synced,
    );
  });

  it('não reenvia face parecida', async () => {
    const similar = {
      deviceSyncStatus: 'sync_failed' as const,
      deviceSyncError:
        'Porta: Este rosto já está cadastrado no leitor (foto muito parecida, comum em gêmeos).',
    };
    const faceSync = {
      syncPersonOnReaders: jest.fn().mockResolvedValue(similar),
      takePersistHook: jest.fn().mockReturnValue(undefined),
    };
    const persist = {
      persistFacePerson: jest.fn().mockResolvedValue(undefined),
    };

    await facePersonHandler(faceSync, persist).run(facePersonJob(), {
      checkpoint: () => Promise.resolve(),
    });

    expect(faceSync.syncPersonOnReaders).toHaveBeenCalledTimes(1);
    expect(persist.persistFacePerson).toHaveBeenCalledWith(
      'client-1',
      'resp-1',
      expect.anything(),
      similar,
    );
  });

  it('não reenvia quando não há leitor ativo', async () => {
    const noReaders = {
      deviceSyncStatus: 'sync_failed' as const,
      deviceSyncError: 'Nenhum leitor ativo com credenciais para este cliente.',
    };
    const faceSync = {
      syncPersonOnReaders: jest.fn().mockResolvedValue(noReaders),
      takePersistHook: jest.fn().mockReturnValue(undefined),
    };
    const persist = {
      persistFacePerson: jest.fn().mockResolvedValue(undefined),
    };

    await facePersonHandler(faceSync, persist).run(facePersonJob(), {
      checkpoint: () => Promise.resolve(),
    });

    expect(faceSync.syncPersonOnReaders).toHaveBeenCalledTimes(1);
    expect(persist.persistFacePerson).toHaveBeenCalledWith(
      'client-1',
      'resp-1',
      expect.anything(),
      noReaders,
    );
  });

  it('não reenvia quando a primeira sincronização já concluiu', async () => {
    const synced = {
      deviceSyncStatus: 'synced' as const,
      deviceSyncError: null,
    };
    const faceSync = {
      syncPersonOnReaders: jest.fn().mockResolvedValue(synced),
      takePersistHook: jest.fn().mockReturnValue(undefined),
    };
    const persist = {
      persistFacePerson: jest.fn().mockResolvedValue(undefined),
    };

    await facePersonHandler(faceSync, persist).run(facePersonJob(), {
      checkpoint: () => Promise.resolve(),
    });

    expect(faceSync.syncPersonOnReaders).toHaveBeenCalledTimes(1);
    expect(persist.persistFacePerson).toHaveBeenCalledWith(
      'client-1',
      'resp-1',
      expect.anything(),
      synced,
    );
  });
});

function facePersonJob(): DeviceSyncJobRow {
  return {
    id: 'job-1',
    kind: 'face.person',
    clientId: 'client-1',
    targetId: 'resp-1',
    payload: {
      entityKind: 'responsible',
      faceId: 12,
      photoKey: 'photo.jpg',
      name: 'Cerenita',
      resetReaderProgress: true,
    },
  } as DeviceSyncJobRow;
}

function facePersonHandler(
  faceSync: {
    syncPersonOnReaders: jest.Mock;
    takePersistHook: jest.Mock;
  },
  persist: { persistFacePerson: jest.Mock },
) {
  return new DeviceSyncJobHandlersService(
    { update: jest.fn().mockResolvedValue(undefined) } as never,
    faceSync as never,
    {} as never,
    persist as never,
    {} as never,
    {
      getObjectBytes: jest.fn().mockResolvedValue({ buffer: Buffer.from('x') }),
    } as never,
    { db: {} } as never,
    {} as never,
  );
}
