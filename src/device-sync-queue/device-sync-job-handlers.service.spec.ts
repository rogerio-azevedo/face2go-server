import * as registrationsQueries from '../database/queries/registrations.queries';
import type { DeviceSyncJobRow } from '../database/schema/device-sync-jobs';
import { DeviceSyncJobHandlersService } from './device-sync-job-handlers.service';

describe('DeviceSyncJobHandlersService face.person', () => {
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
});
