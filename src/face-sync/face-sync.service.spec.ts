import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

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
  let queue: { enqueue: jest.Mock };

  beforeEach(async () => {
    queue = { enqueue: jest.fn().mockResolvedValue({ id: 'job-1' }) };
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
});
