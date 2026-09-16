import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DatabaseService } from '../database/database.service';
import * as personBirthDateQueries from '../database/queries/person-birth-date.queries';
import * as personReaderSyncQueries from '../database/queries/person-reader-sync.queries';
import * as readersQueries from '../database/queries/readers.queries';
import * as registrationsQueries from '../database/queries/registrations.queries';
import type { RegistrationRow } from '../database/queries/registrations.queries';
import type { ReaderFaceSyncRow } from '../database/queries/readers.queries';
import { DeviceSyncQueueService } from '../device-sync-queue/device-sync-queue.service';
import * as hikvision from '../integrations/hikvision';
import { PermissionsService } from '../permissions/permissions.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { AccessTimeZoneService } from './access-time-zone.service';
import * as faceImageVariants from './face-image-variants';
import {
  FaceSyncService,
  type FaceSyncProgressEvent,
} from './face-sync.service';
import * as cipherMod from '../common/crypto/reader-credentials.cipher';

jest.mock('../integrations/hikvision', () => {
  /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
  const actual = jest.requireActual('../integrations/hikvision');
  return {
    ...actual,
    hikvisionSyncFace: jest.fn(),
    hikvisionDeleteUser: jest.fn(),
  };
  /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
});

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
    status: 'approved',
    isActive: true,
    deviceSyncStatus: 'synced',
    deviceSyncError: null,
    ...overrides,
  } as RegistrationRow;
}

describe('FaceSyncService', () => {
  let service: FaceSyncService;
  let queue: {
    enqueue: jest.Mock;
    toDto: jest.Mock;
    listActiveFace: jest.Mock;
  };

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
        {
          provide: ConfigService,
          useValue: { get: jest.fn(() => 'aa'.repeat(32)) },
        },
        { provide: PermissionsService, useValue: {} },
        {
          provide: AccessTimeZoneService,
          useValue: {
            loadShiftsByZoneIndex: jest.fn().mockResolvedValue(new Map()),
            ensureZonesOnSingleReader: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: DeviceSyncQueueService, useValue: queue },
      ],
    }).compile();

    service = module.get(FaceSyncService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.mocked(hikvision.hikvisionSyncFace).mockReset();
    jest.mocked(hikvision.hikvisionDeleteUser).mockReset();
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

  it('enqueuePersonSync assume resetReaderProgress true (foto nova)', async () => {
    const result = await service.enqueuePersonSync({
      clientId: 'c1',
      faceId: 1,
      name: 'Maria',
      persistResult: () => Promise.resolve(),
    });
    const [arg] = queue.enqueue.mock.calls[0] as [
      { payload: { resetReaderProgress?: boolean } },
    ];
    expect(arg.payload.resetReaderProgress).toBe(true);
    expect(result).toEqual({
      deviceSyncStatus: 'pending_sync',
      deviceSyncError: null,
      jobId: 'job-1',
    });
    expect(service.takePersistHook('job-1')).toBeDefined();
  });

  it('enqueuePersonSync preserva resetReaderProgress false (retry)', async () => {
    await service.enqueuePersonSync({
      clientId: 'c1',
      faceId: 1,
      name: 'Maria',
      resetReaderProgress: false,
      persistResult: () => Promise.resolve(),
    });
    const [arg] = queue.enqueue.mock.calls[0] as [
      { payload: { resetReaderProgress?: boolean } },
    ];
    expect(arg.payload.resetReaderProgress).toBe(false);
  });

  it('enqueuePersonSync persiste sync_failed quando a fila recusa', async () => {
    queue.enqueue.mockRejectedValueOnce(new Error('fila cheia'));
    const persistResult = jest.fn().mockResolvedValue(undefined);
    await expect(
      service.enqueuePersonSync({
        clientId: 'c1',
        faceId: 1,
        name: 'Maria',
        persistResult,
      }),
    ).resolves.toEqual({
      deviceSyncStatus: 'sync_failed',
      deviceSyncError: 'fila cheia',
    });
    expect(persistResult).toHaveBeenCalledWith({
      deviceSyncStatus: 'sync_failed',
      deviceSyncError: 'fila cheia',
    });
  });

  it('getApprovedRegistrationSyncStatus devolve o resumo do cadastro', async () => {
    jest
      .spyOn(registrationsQueries, 'getRegistrationByIdForClient')
      .mockResolvedValue(
        registration({
          status: 'approved',
          faceId: 10,
          deviceSyncStatus: 'synced',
          deviceSyncError: 'Sincronizado parcialmente (1 de 2 leitor(es)).',
        }),
      );
    jest
      .spyOn(readersQueries, 'listReadersForFaceSyncByClient')
      .mockResolvedValue([
        { id: 'r1' },
        { id: 'r2' },
      ] as readersQueries.ReaderFaceSyncRow[]);
    jest
      .spyOn(personReaderSyncQueries, 'countSyncedPersonReaderSyncByFaceIds')
      .mockResolvedValue(new Map([[10, 1]]));

    await expect(
      service.getApprovedRegistrationSyncStatus('reg-1', 'client-1'),
    ).resolves.toEqual({
      deviceSyncStatus: 'synced',
      deviceSyncError: 'Sincronizado parcialmente (1 de 2 leitor(es)).',
      readerSyncSynced: 1,
      readerSyncTotal: 2,
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

    await service.enqueueApprovedRegistrationJob(
      'reg-1',
      'client-1',
      'user-1',
      {
        resetReaderProgress: true,
      },
    );

    const [arg] = queue.enqueue.mock.calls[0] as [
      {
        force?: boolean;
        dedupeKey: string;
        payload: { resetReaderProgress?: boolean };
      },
    ];
    expect(arg.payload.resetReaderProgress).toBe(true);
    expect(arg.force).toBe(true);
    expect(arg.dedupeKey).toBe('face.person:client-1:registration:reg-1:force');
  });

  it('enqueueMinorRestrictionCleanup usa job incremental sem checar fila ativa', async () => {
    await service.enqueueMinorRestrictionCleanup(
      'client-1',
      'reader-1',
      'user-1',
    );
    expect(queue.listActiveFace).not.toHaveBeenCalled();
    const [arg] = queue.enqueue.mock.calls[0] as [
      { kind: string; dedupeKey: string; force: boolean },
    ];
    expect(arg.kind).toBe('face.reader');
    expect(arg.force).toBe(false);
    expect(arg.dedupeKey).toBe('face.reader:client-1:reader-1:incremental');
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

  it('syncPersonOnReaders não envia menor ao leitor 18+ e remove só nele', async () => {
    const cervejeira: ReaderFaceSyncRow = {
      id: 'cervejeira',
      name: 'Porta Cervejeira',
      brand: 'hikvision',
      ip: '10.0.0.1',
      port: 80,
      username: 'admin',
      passwordEncrypted: 'enc',
      restrictMinors: true,
    };
    const entrada: ReaderFaceSyncRow = {
      ...cervejeira,
      id: 'entrada',
      name: 'Porta Entrada',
      ip: '10.0.0.2',
      restrictMinors: false,
    };
    const saida: ReaderFaceSyncRow = {
      ...cervejeira,
      id: 'saida',
      name: 'Porta Saida',
      ip: '10.0.0.3',
      restrictMinors: false,
    };

    jest
      .spyOn(readersQueries, 'listReadersForFaceSyncByClient')
      .mockResolvedValue([cervejeira, entrada, saida]);
    jest
      .spyOn(personBirthDateQueries, 'getBirthDateByFaceId')
      .mockResolvedValue('2012-10-10');
    jest
      .spyOn(personReaderSyncQueries, 'listPersonReaderSyncByFace')
      .mockResolvedValue([]);
    jest
      .spyOn(personReaderSyncQueries, 'deletePersonReaderSyncByFaceAndReader')
      .mockResolvedValue(undefined);
    jest
      .spyOn(personReaderSyncQueries, 'upsertPersonReaderSync')
      .mockResolvedValue(undefined);
    jest.spyOn(cipherMod, 'createReaderCredentialsCipher').mockReturnValue({
      encrypt: (value: string) => value,
      decrypt: () => 'secret',
    });
    jest
      .spyOn(faceImageVariants, 'loadOrCreateReaderFaceVariant')
      .mockResolvedValue(Buffer.from('jpeg'));
    const syncFace = jest.mocked(hikvision.hikvisionSyncFace);
    syncFace.mockResolvedValue(undefined);
    const deleteUser = jest.mocked(hikvision.hikvisionDeleteUser);
    deleteUser.mockResolvedValue({ success: true });

    const outcome = await service.syncPersonOnReaders({
      clientId: 'client-1',
      faceId: 2,
      name: 'Marcos Menor',
      imageBuffer: Buffer.from('raw'),
      photoKey: 'c/reg/face.jpg',
      logContext: 'test',
    });

    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(syncFace).toHaveBeenCalledTimes(2);
    const deletedIds = deleteUser.mock.calls.map(
      ([connection]) => connection.baseUrl,
    );
    expect(deletedIds).toEqual(['http://10.0.0.1']);
    const syncedIps = syncFace.mock.calls.map(
      ([connection]) => connection.baseUrl,
    );
    expect(syncedIps.sort()).toEqual(['http://10.0.0.2', 'http://10.0.0.3']);
    expect(outcome.deviceSyncStatus).toBe('synced');
    expect(outcome.deviceSyncError).toBeNull();
  });

  it('quando os leitores abertos falham, o agregado é 2 de 2 sem o 18+', async () => {
    const cervejeira: ReaderFaceSyncRow = {
      id: 'cervejeira',
      name: 'Porta Cervejeira',
      brand: 'hikvision',
      ip: '10.0.0.1',
      port: 80,
      username: 'admin',
      passwordEncrypted: 'enc',
      restrictMinors: true,
    };
    const entrada: ReaderFaceSyncRow = {
      ...cervejeira,
      id: 'entrada',
      name: 'Porta Entrada',
      ip: '10.0.0.2',
      restrictMinors: false,
    };
    const saida: ReaderFaceSyncRow = {
      ...cervejeira,
      id: 'saida',
      name: 'Porta Saida',
      ip: '10.0.0.3',
      restrictMinors: false,
    };

    jest
      .spyOn(readersQueries, 'listReadersForFaceSyncByClient')
      .mockResolvedValue([cervejeira, entrada, saida]);
    jest
      .spyOn(personBirthDateQueries, 'getBirthDateByFaceId')
      .mockResolvedValue('2012-10-10');
    jest
      .spyOn(personReaderSyncQueries, 'listPersonReaderSyncByFace')
      .mockResolvedValue([]);
    jest
      .spyOn(personReaderSyncQueries, 'deletePersonReaderSyncByFaceAndReader')
      .mockResolvedValue(undefined);
    jest
      .spyOn(personReaderSyncQueries, 'upsertPersonReaderSync')
      .mockResolvedValue(undefined);
    jest.spyOn(cipherMod, 'createReaderCredentialsCipher').mockReturnValue({
      encrypt: (value: string) => value,
      decrypt: () => 'secret',
    });
    jest
      .spyOn(faceImageVariants, 'loadOrCreateReaderFaceVariant')
      .mockResolvedValue(Buffer.from('jpeg'));
    jest
      .mocked(hikvision.hikvisionSyncFace)
      .mockRejectedValue(new Error('timeout of 12000ms exceeded'));
    jest
      .mocked(hikvision.hikvisionDeleteUser)
      .mockResolvedValue({ success: true });

    const outcome = await service.syncPersonOnReaders({
      clientId: 'client-1',
      faceId: 2,
      name: 'Marcos Menor',
      imageBuffer: Buffer.from('raw'),
      photoKey: 'c/reg/face.jpg',
    });

    expect(hikvision.hikvisionSyncFace).toHaveBeenCalledTimes(2);
    expect(hikvision.hikvisionDeleteUser).toHaveBeenCalledTimes(1);
    expect(outcome.deviceSyncStatus).toBe('sync_failed');
    expect(outcome.deviceSyncError).toMatch(/2 de 2/);
    expect(outcome.deviceSyncError).not.toMatch(/Cervejeira/);
  });
});
