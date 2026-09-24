import { DeviceSyncQueueService } from './device-sync-queue.service';
import * as jobQueries from '../database/queries/device-sync-jobs.queries';

describe('DeviceSyncQueueService.enqueue', () => {
  const service = new DeviceSyncQueueService({ db: {} } as never);
  const input: jobQueries.EnqueueDeviceSyncJobInput = {
    kind: 'face.person',
    clientId: 'client-1',
    targetId: 'reg-1',
    dedupeKey: 'face.person:client-1:registration:reg-1:force',
    force: true,
    payload: { blocked: false },
    createdBy: 'user-2',
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('atualiza o payload quando já existe job queued', async () => {
    jest.spyOn(jobQueries, 'findActiveJobByDedupe').mockResolvedValue({
      id: 'job-1',
      status: 'queued',
      force: false,
      createdBy: 'user-1',
    } as never);
    const update = jest
      .spyOn(jobQueries, 'updateQueuedJobPayload')
      .mockResolvedValue({ id: 'job-1', status: 'queued' } as never);
    const insert = jest.spyOn(jobQueries, 'insertDeviceSyncJob');

    const row = await service.enqueue(input);

    expect(row.id).toBe('job-1');
    expect(insert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      {},
      'job-1',
      expect.objectContaining({
        payload: { blocked: false },
        force: true,
        createdBy: 'user-2',
      }),
    );
  });

  it('insere um job novo quando o ativo está running', async () => {
    jest.spyOn(jobQueries, 'findActiveJobByDedupe').mockResolvedValue({
      id: 'job-running',
      status: 'running',
      force: true,
    } as never);
    const insert = jest
      .spyOn(jobQueries, 'insertDeviceSyncJob')
      .mockResolvedValue({ id: 'job-2', status: 'queued' } as never);
    const update = jest.spyOn(jobQueries, 'updateQueuedJobPayload');

    const row = await service.enqueue(input);

    expect(row.id).toBe('job-2');
    expect(update).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith({}, input);
  });
});
