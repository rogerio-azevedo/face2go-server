import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import * as clientsQueries from '../database/queries/clients.queries';
import * as adminQueries from '../database/queries/device-sync-jobs-admin.queries';
import type { DeviceSyncJobRow } from '../database/schema/device-sync-jobs';
import { DeviceSyncAdminService } from './device-sync-admin.service';

const admin: JwtPayload = {
  sub: 'user-1',
  email: 'admin@face2go.com.br',
  role: 'company_admin',
  contextType: 'company',
  companyId: 'company-1',
};

function job(overrides: Partial<DeviceSyncJobRow> = {}): DeviceSyncJobRow {
  return {
    id: 'job-1',
    kind: 'face.person',
    clientId: 'client-1',
    targetId: 'reg-1',
    status: 'queued',
    force: false,
    dedupeKey: 'face.person:client-1:registration:reg-1',
    payload: { entityKind: 'registration', name: 'Otoniel' },
    processed: 0,
    total: 1,
    attempts: 0,
    cancelRequested: false,
    error: null,
    createdAt: new Date('2026-09-25T15:00:00Z'),
    startedAt: null,
    finishedAt: null,
    ...overrides,
  } as DeviceSyncJobRow;
}

function setup() {
  const queue = {
    getById: jest.fn(),
    enqueue: jest.fn().mockResolvedValue(job({ id: 'job-2' })),
    toDto: jest.fn((row: DeviceSyncJobRow) => ({ jobId: row.id })),
  };
  const persist = { persistFacePerson: jest.fn().mockResolvedValue(undefined) };
  const service = new DeviceSyncAdminService(
    { db: {} } as never,
    queue as never,
    persist as never,
  );
  jest
    .spyOn(clientsQueries, 'getClientById')
    .mockResolvedValue({ id: 'client-1' } as never);
  return { service, queue, persist };
}

describe('DeviceSyncAdminService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('bloqueia quem não é company_admin', async () => {
    const { service } = setup();

    await expect(
      service.summary({ ...admin, role: 'company_operator' }, 'client-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('bloqueia cliente de outra empresa', async () => {
    const { service } = setup();
    jest.spyOn(clientsQueries, 'getClientById').mockResolvedValue(undefined);

    await expect(service.summary(admin, 'client-x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('cancela job na fila e tira o cadastro de "pendente"', async () => {
    const { service, queue, persist } = setup();
    const queued = job();
    queue.getById.mockResolvedValue(queued);
    jest
      .spyOn(adminQueries, 'cancelQueuedDeviceSyncJobs')
      .mockResolvedValue([{ ...queued, status: 'canceled' }]);

    const result = await service.cancel(admin, 'client-1', 'job-1');

    expect(result).toEqual({ result: 'canceled' });
    expect(persist.persistFacePerson).toHaveBeenCalledWith(
      'client-1',
      'reg-1',
      queued.payload,
      { deviceSyncStatus: 'sync_failed', deviceSyncError: 'Sync cancelado.' },
    );
  });

  it('job em execução recebe pedido de cancelamento', async () => {
    const { service, queue } = setup();
    queue.getById.mockResolvedValue(job({ status: 'running' }));
    jest
      .spyOn(adminQueries, 'requestCancelRunningDeviceSyncJob')
      .mockResolvedValue(true);

    await expect(service.cancel(admin, 'client-1', 'job-1')).resolves.toEqual({
      result: 'cancel_requested',
    });
  });

  it('job já terminado não pode ser cancelado', async () => {
    const { service, queue } = setup();
    queue.getById.mockResolvedValue(job({ status: 'done' }));
    jest
      .spyOn(adminQueries, 'requestCancelRunningDeviceSyncJob')
      .mockResolvedValue(false);

    await expect(
      service.cancel(admin, 'client-1', 'job-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reprocessa job com falha reenfileirando o mesmo payload', async () => {
    const { service, queue } = setup();
    const failed = job({ status: 'failed', error: 'Hikvision ISAPI 502' });
    queue.getById.mockResolvedValue(failed);

    await service.retry(admin, 'client-1', 'job-1');

    expect(queue.enqueue).toHaveBeenCalledWith({
      kind: 'face.person',
      clientId: 'client-1',
      targetId: 'reg-1',
      force: false,
      dedupeKey: failed.dedupeKey,
      payload: failed.payload,
      total: 1,
      createdBy: 'user-1',
    });
  });

  it('não reprocessa job que ainda está ativo', async () => {
    const { service, queue } = setup();
    queue.getById.mockResolvedValue(job({ status: 'running' }));

    await expect(
      service.retry(admin, 'client-1', 'job-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('lista com rótulo de pessoa, leitor e lote escolar', async () => {
    const { service } = setup();
    jest.spyOn(adminQueries, 'listClientDeviceSyncJobs').mockResolvedValue({
      rows: [
        { ...job(), readerName: null, cameraName: null },
        {
          ...job({ id: 'job-r', kind: 'face.reader', payload: {} }),
          readerName: 'Acesso Loja',
          cameraName: null,
        },
        {
          ...job({
            id: 'job-s',
            kind: 'face.school',
            payload: { entityKind: 'student' },
          }),
          readerName: null,
          cameraName: null,
        },
      ],
      total: 3,
    });

    const list = await service.list(admin, 'client-1', {
      status: 'active',
      page: 1,
      pageSize: 50,
    });

    expect(list.items.map((i) => i.label)).toEqual([
      'Otoniel',
      'Acesso Loja',
      'Alunos',
    ]);
    expect(adminQueries.listClientDeviceSyncJobs).toHaveBeenCalledWith(
      {},
      'client-1',
      {
        statuses: ['queued', 'running'],
        kinds: undefined,
        limit: 50,
        offset: 0,
      },
    );
  });

  it('usuário de empresa não lê job de cliente de outra empresa', async () => {
    const { service } = setup();
    jest.spyOn(clientsQueries, 'getClientById').mockResolvedValue(undefined);

    await expect(
      service.ensureJobReadable(
        { ...admin, role: 'company_operator' },
        'client-x',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
