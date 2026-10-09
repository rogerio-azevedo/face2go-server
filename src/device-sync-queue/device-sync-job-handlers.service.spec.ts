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
});
