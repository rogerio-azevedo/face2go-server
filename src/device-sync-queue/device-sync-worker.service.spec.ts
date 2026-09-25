import type { DeviceSyncJobRow } from '../database/schema/device-sync-jobs';
import { SUPERSEDED_JOB_ERROR } from '../database/queries/device-sync-jobs.queries';
import { JobCanceledError } from './device-sync-job-handlers.service';
import { DeviceSyncWorkerService } from './device-sync-worker.service';

function job(overrides: Partial<DeviceSyncJobRow> = {}): DeviceSyncJobRow {
  return {
    id: 'job-1',
    kind: 'face.person',
    clientId: 'client-1',
    targetId: 'reg-1',
    status: 'running',
    payload: { entityKind: 'registration' },
    error: null,
    ...overrides,
  } as DeviceSyncJobRow;
}

function setup() {
  const queue = {
    finish: jest.fn().mockResolvedValue(true),
    heartbeat: jest.fn().mockResolvedValue({ owned: true }),
    isCancelRequested: jest.fn().mockResolvedValue(false),
    recoverRunning: jest.fn().mockResolvedValue([]),
    purgeFinished: jest.fn().mockResolvedValue(0),
    listByIds: jest.fn().mockResolvedValue([]),
  };
  const handlers = {
    run: jest.fn().mockResolvedValue(undefined),
    persistFailedFacePerson: jest.fn().mockResolvedValue(undefined),
  };
  const worker = new DeviceSyncWorkerService(queue as never, handlers as never);
  return { worker, queue, handlers };
}

describe('DeviceSyncWorkerService.runJob', () => {
  it('conclui como done usando o lease da instância', async () => {
    const { worker, queue, handlers } = setup();

    await worker.runJob(job());

    expect(queue.finish).toHaveBeenCalledWith('job-1', worker.workerId, {
      status: 'done',
    });
    expect(handlers.persistFailedFacePerson).not.toHaveBeenCalled();
  });

  it('marca failed e persiste o erro no cadastro', async () => {
    const { worker, queue, handlers } = setup();
    handlers.run.mockRejectedValue(new Error('Hikvision ISAPI 502'));

    await worker.runJob(job());

    expect(queue.finish).toHaveBeenCalledWith('job-1', worker.workerId, {
      status: 'failed',
      error: 'Hikvision ISAPI 502',
    });
    expect(handlers.persistFailedFacePerson).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'job-1' }),
      'Hikvision ISAPI 502',
    );
  });

  it('não persiste quando o reaper já tirou o job desta instância', async () => {
    const { worker, queue, handlers } = setup();
    handlers.run.mockRejectedValue(new Error('timeout'));
    queue.finish.mockResolvedValue(false);

    await worker.runJob(job());

    expect(handlers.persistFailedFacePerson).not.toHaveBeenCalled();
  });

  it('checkpoint com cancelamento pedido encerra como canceled', async () => {
    const { worker, queue, handlers } = setup();
    queue.isCancelRequested.mockResolvedValue(true);
    handlers.run.mockImplementation(
      async (_job: unknown, ctx: { checkpoint(): Promise<void> }) => {
        await ctx.checkpoint();
      },
    );

    await worker.runJob(job({ kind: 'face.reader' }));

    expect(queue.finish).toHaveBeenCalledWith('job-1', worker.workerId, {
      status: 'canceled',
      error: new JobCanceledError().message,
    });
    expect(handlers.persistFailedFacePerson).toHaveBeenCalledWith(
      expect.anything(),
      'Sync cancelado.',
    );
  });
});

describe('DeviceSyncWorkerService.maintain', () => {
  it('recupera jobs sem heartbeat e persiste só os que terminaram de vez', async () => {
    const { worker, queue, handlers } = setup();
    queue.recoverRunning.mockResolvedValue([
      { id: 'a', status: 'queued' },
      { id: 'b', status: 'failed' },
      { id: 'c', status: 'failed' },
    ]);
    const exhausted = job({
      id: 'b',
      status: 'failed',
      error: 'Worker parou de responder (3 tentativas).',
    });
    const superseded = job({
      id: 'c',
      status: 'failed',
      error: SUPERSEDED_JOB_ERROR,
    });
    queue.listByIds.mockResolvedValue([exhausted, superseded]);

    await worker.maintain();

    expect(queue.recoverRunning).toHaveBeenCalledWith({ staleSeconds: 120 }, 3);
    expect(queue.listByIds).toHaveBeenCalledWith(['b', 'c']);
    expect(handlers.persistFailedFacePerson).toHaveBeenCalledTimes(1);
    expect(handlers.persistFailedFacePerson).toHaveBeenCalledWith(
      exhausted,
      'Worker parou de responder (3 tentativas).',
    );
    expect(queue.purgeFinished).toHaveBeenCalledTimes(1);
  });

  it('retenção roda no máximo a cada 10 minutos', async () => {
    const { worker, queue } = setup();

    await worker.maintain();
    await worker.maintain();

    expect(queue.purgeFinished).toHaveBeenCalledTimes(1);
  });
});

describe('DeviceSyncWorkerService.onModuleDestroy', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('devolve para a fila os jobs desta instância que não terminaram', async () => {
    jest.useFakeTimers();
    const { worker, queue } = setup();
    (worker as unknown as { loops: Promise<void>[] }).loops = [
      new Promise<void>(() => undefined),
    ];

    const destroyed = worker.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(20_000);
    await destroyed;

    expect(queue.recoverRunning).toHaveBeenCalledWith(
      { lockedBy: worker.workerId },
      3,
    );
  });

  it('não mexe na fila quando os loops terminam a tempo', async () => {
    const { worker, queue } = setup();

    await worker.onModuleDestroy();

    expect(queue.recoverRunning).not.toHaveBeenCalled();
  });
});
