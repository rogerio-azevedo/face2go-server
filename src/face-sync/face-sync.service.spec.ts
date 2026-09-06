import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DatabaseService } from '../database/database.service';
import * as registrationsQueries from '../database/queries/registrations.queries';
import type { RegistrationRow } from '../database/queries/registrations.queries';
import { DeviceSyncQueueService } from '../device-sync-queue/device-sync-queue.service';
import { PermissionsService } from '../permissions/permissions.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { AccessTimeZoneService } from './access-time-zone.service';
import {
  FaceSyncService,
  type FaceSyncProgressEvent,
} from './face-sync.service';

function clientUser(): JwtPayload {
  return {
    sub: 'user-1',
    email: 'a@b.c',
    role: 'client_admin',
    contextType: 'client',
    clientId: 'client-1',
  };
}

function registration(
  overrides: Partial<RegistrationRow> = {},
): RegistrationRow {
  return {
    id: 'reg-1',
    name: 'Maria',
    deviceSyncStatus: 'synced',
    deviceSyncError: null,
    ...overrides,
  } as RegistrationRow;
}

describe('FaceSyncService', () => {
  let service: FaceSyncService;
  let queue: { enqueue: jest.Mock; toDto: jest.Mock; listActiveFace: jest.Mock };

  beforeEach(async () => {
    queue = {
      enqueue: jest.fn().mockResolvedValue({
        id: 'job-1',
        kind: 'face.person',
        status: 'queued',
        force: false,
        targetId: 'reg-1',
        processed: 0,
        total: 1,
        error: null,
        payload: { entityKind: 'registration' },
      }),
      toDto: jest.fn((row: { id: string; status?: string }) => ({
        jobId: row.id,
        status: row.status ?? 'queued',
      })),
      listActiveFace: jest.fn().mockResolvedValue([]),
    };
    const module = await Test.createTestingModule({
      providers: [
        FaceSyncService,
        { provide: DatabaseService, useValue: { db: {} } },
        { provide: R2StorageService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: PermissionsService, useValue: {} },
        { provide: AccessTimeZoneService, useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: DeviceSyncQueueService, useValue: queue },
      ],
    }).compile();

    service = module.get(FaceSyncService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('emite ok:false quando o cadastro permanece parcial', async () => {
    const partialError =
      'Sincronizado parcialmente (1 de 2 leitor(es)). Portaria: offline';
    const row = registration({ deviceSyncError: partialError });
    jest
      .spyOn(registrationsQueries, 'listApprovedRegistrationsPendingDeviceSync')
      .mockResolvedValue([row]);
    jest.spyOn(service, 'syncApprovedRegistration').mockResolvedValue({
      deviceSyncStatus: 'synced',
      deviceSyncError: partialError,
    });
    jest
      .spyOn(registrationsQueries, 'getRegistrationByIdForClient')
      .mockResolvedValue(row);

    const events: FaceSyncProgressEvent[] = [];
    await service.syncAllPending('client-1', (e) => events.push(e));

    expect(events).toContainEqual({
      type: 'item',
      registrationId: 'reg-1',
      name: 'Maria',
      ok: false,
      error: partialError,
    });
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  it('emite ok:true quando o cadastro fica totalmente sincronizado', async () => {
    jest
      .spyOn(registrationsQueries, 'listApprovedRegistrationsPendingDeviceSync')
      .mockResolvedValue([
        registration({
          deviceSyncStatus: 'pending_sync',
          deviceSyncError: null,
        }),
      ]);
    jest.spyOn(service, 'syncApprovedRegistration').mockResolvedValue({
      deviceSyncStatus: 'synced',
      deviceSyncError: null,
    });
    jest
      .spyOn(registrationsQueries, 'getRegistrationByIdForClient')
      .mockResolvedValue(registration({ deviceSyncError: null }));

    const events: FaceSyncProgressEvent[] = [];
    await service.syncAllPending('client-1', (e) => events.push(e));

    expect(events).toContainEqual({
      type: 'item',
      registrationId: 'reg-1',
      name: 'Maria',
      ok: true,
    });
  });

  it('enqueuePersonSync assume resetReaderProgress true (foto nova)', () => {
    service.enqueuePersonSync({
      clientId: 'c1',
      faceId: 1,
      name: 'Maria',
      imageBuffer: Buffer.from('x'),
      persistResult: () => Promise.resolve(),
    });
    const [arg] = queue.enqueue.mock.calls[0] as [
      { payload: { resetReaderProgress?: boolean } },
    ];
    expect(arg.payload.resetReaderProgress).toBe(true);
  });

  it('enqueuePersonSync preserva resetReaderProgress false (retry)', () => {
    service.enqueuePersonSync({
      clientId: 'c1',
      faceId: 1,
      name: 'Maria',
      imageBuffer: Buffer.from('x'),
      resetReaderProgress: false,
      persistResult: () => Promise.resolve(),
    });
    const [arg] = queue.enqueue.mock.calls[0] as [
      { payload: { resetReaderProgress?: boolean } },
    ];
    expect(arg.payload.resetReaderProgress).toBe(false);
  });

  it('getApprovedRegistrationSyncStatus devolve o resumo do cadastro', async () => {
    jest
      .spyOn(registrationsQueries, 'getRegistrationByIdForClient')
      .mockResolvedValue(
        registration({
          status: 'approved',
          deviceSyncStatus: 'synced',
          deviceSyncError: 'Sincronizado parcialmente (1 de 2 leitor(es)).',
        }),
      );

    await expect(
      service.getApprovedRegistrationSyncStatus('reg-1', 'client-1'),
    ).resolves.toEqual({
      deviceSyncStatus: 'synced',
      deviceSyncError: 'Sincronizado parcialmente (1 de 2 leitor(es)).',
    });
  });

  it('enqueueAllPendingRegistrations incremental lista só incompletos sem reset', async () => {
    const list = jest
      .spyOn(registrationsQueries, 'listApprovedRegistrationsForDeviceSync')
      .mockResolvedValue([registration({ id: 'reg-pending' })]);
    const enqueue = jest
      .spyOn(service, 'enqueueApprovedRegistrationJob')
      .mockResolvedValue({ jobId: 'job-1' } as never);

    const ids = await service.enqueueAllPendingRegistrations(
      clientUser(),
      'client-1',
      false,
    );

    expect(list).toHaveBeenCalledWith({}, 'client-1', { includeSynced: false });
    expect(enqueue).toHaveBeenCalledWith('reg-pending', 'client-1', 'user-1', {
      resetReaderProgress: false,
    });
    expect(ids).toEqual(['job-1']);
  });

  it('enqueueAllPendingRegistrations force inclui synced e reseta progresso', async () => {
    const list = jest
      .spyOn(registrationsQueries, 'listApprovedRegistrationsForDeviceSync')
      .mockResolvedValue([registration({ id: 'reg-synced' })]);
    const enqueue = jest
      .spyOn(service, 'enqueueApprovedRegistrationJob')
      .mockResolvedValue({ jobId: 'job-force' } as never);

    const ids = await service.enqueueAllPendingRegistrations(
      clientUser(),
      'client-1',
      true,
    );

    expect(list).toHaveBeenCalledWith({}, 'client-1', { includeSynced: true });
    expect(enqueue).toHaveBeenCalledWith('reg-synced', 'client-1', 'user-1', {
      resetReaderProgress: true,
    });
    expect(ids).toEqual(['job-force']);
  });

  it('enqueueApprovedRegistrationJob incremental não reseta progresso do leitor', async () => {
    jest
      .spyOn(registrationsQueries, 'getRegistrationByIdForClient')
      .mockResolvedValue(
        registration({
          status: 'approved',
          faceImageKey: 'photo',
          faceId: 10,
        }),
      );
    jest
      .spyOn(registrationsQueries, 'updateRegistrationDeviceSync')
      .mockResolvedValue(registration());

    await service.enqueueApprovedRegistrationJob('reg-1', 'client-1', 'user-1');

    const [arg] = queue.enqueue.mock.calls[0] as [
      {
        force?: boolean;
        dedupeKey: string;
        payload: { resetReaderProgress?: boolean };
      },
    ];
    expect(arg.payload.resetReaderProgress).toBe(false);
    expect(arg.force).toBe(false);
    expect(arg.dedupeKey).toBe('face.person:client-1:registration:reg-1');
  });

  it('enqueueApprovedRegistrationJob force reseta progresso do leitor', async () => {
    jest
      .spyOn(registrationsQueries, 'getRegistrationByIdForClient')
      .mockResolvedValue(
        registration({
          status: 'approved',
          faceImageKey: 'photo',
          faceId: 10,
        }),
      );
    jest
      .spyOn(registrationsQueries, 'updateRegistrationDeviceSync')
      .mockResolvedValue(registration());

    await service.enqueueApprovedRegistrationJob('reg-1', 'client-1', 'user-1', {
      resetReaderProgress: true,
    });

    const [arg] = queue.enqueue.mock.calls[0] as [
      {
        force?: boolean;
        dedupeKey: string;
        payload: { resetReaderProgress?: boolean };
      },
    ];
    expect(arg.payload.resetReaderProgress).toBe(true);
    expect(arg.force).toBe(true);
    expect(arg.dedupeKey).toBe(
      'face.person:client-1:registration:reg-1:force',
    );
  });

  it('getRegistrationSyncAllStatus resume queued e running', async () => {
    queue.listActiveFace.mockResolvedValue([
      { id: 'j1', status: 'queued' },
      { id: 'j2', status: 'running' },
      { id: 'j3', status: 'queued' },
    ]);

    await expect(
      service.getRegistrationSyncAllStatus(clientUser(), 'client-1'),
    ).resolves.toEqual({ queued: 2, running: 1 });
  });
});
