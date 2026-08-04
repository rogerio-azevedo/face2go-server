import { Test, TestingModule } from '@nestjs/testing';

import { DatabaseService } from '../database/database.service';
import * as membersQueries from '../database/queries/members.queries';
import * as peopleQueries from '../database/queries/people.queries';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import { AccessTimeZoneService } from '../face-sync/access-time-zone.service';
import { FaceSyncService } from '../face-sync/face-sync.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { PersonProfileService } from './person-profile.service';

jest.mock('../storage/portrait-image.utils', () => ({
  isPortraitImageUsable: jest.fn().mockResolvedValue(true),
}));

describe('PersonProfileService.applySharedFaceFromSameClient', () => {
  const userId = 'user-1';
  const clientId = 'client-1';
  const sharedFace = {
    faceId: 42,
    photoKey: 'responsibles/client-1/resp-1/face.jpg',
    deviceSyncStatus: 'sync_failed' as const,
    deviceSyncedAt: null,
    deviceSyncError: 'Erro anterior',
  };
  const imageBuffer = Buffer.alloc(512, 1);

  let service: PersonProfileService;
  let r2: { getObjectBytes: jest.Mock };
  let faceSync: { syncPersonOnReaders: jest.Mock };
  let accessTimeZone: { resolveMemberTimeSections: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();

    r2 = {
      getObjectBytes: jest
        .fn()
        .mockResolvedValue({ buffer: imageBuffer, contentType: 'image/jpeg' }),
    };
    faceSync = {
      syncPersonOnReaders: jest.fn().mockResolvedValue({
        deviceSyncStatus: 'synced',
        deviceSyncError: null,
      }),
    };
    accessTimeZone = {
      resolveMemberTimeSections: jest.fn().mockResolvedValue([255]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonProfileService,
        { provide: DatabaseService, useValue: { db: {} } },
        { provide: R2StorageService, useValue: r2 },
        { provide: FaceSyncService, useValue: faceSync },
        { provide: AccessTimeZoneService, useValue: accessTimeZone },
      ],
    }).compile();

    service = module.get(PersonProfileService);

    jest
      .spyOn(peopleQueries, 'findSharedFaceByUserIdAndClient')
      .mockResolvedValue(sharedFace);
    jest.spyOn(membersQueries, 'updateMemberFace').mockResolvedValue(undefined);
    jest
      .spyOn(peopleQueries, 'listSiblingBondsByUserIdAndClient')
      .mockResolvedValue({ responsibleIds: ['resp-1'], memberIds: [] });
    jest
      .spyOn(responsiblesQueries, 'updateResponsibleFace')
      .mockResolvedValue(undefined);
  });

  it('retorna false quando não há face compartilhada na mesma escola', async () => {
    jest
      .spyOn(peopleQueries, 'findSharedFaceByUserIdAndClient')
      .mockResolvedValue(null);

    const result = await service.applySharedFaceFromSameClient(
      userId,
      clientId,
      { type: 'member', id: 'member-1', name: 'Rogerio' },
    );

    expect(result).toBe(false);
    expect(r2.getObjectBytes).not.toHaveBeenCalled();
    expect(faceSync.syncPersonOnReaders).not.toHaveBeenCalled();
  });

  it('sincroniza no leitor e persiste status real (não apenas copia do irmão)', async () => {
    const target = { type: 'member' as const, id: 'member-1', name: 'Rogerio' };

    const result = await service.applySharedFaceFromSameClient(
      userId,
      clientId,
      target,
    );

    expect(result).toBe(true);
    expect(r2.getObjectBytes).toHaveBeenCalledWith(sharedFace.photoKey);
    expect(accessTimeZone.resolveMemberTimeSections).toHaveBeenCalledWith(
      clientId,
      'member-1',
    );
    expect(faceSync.syncPersonOnReaders).toHaveBeenCalledWith({
      clientId,
      faceId: sharedFace.faceId,
      name: 'Rogerio',
      imageBuffer,
      timeSectionIds: [255],
      logContext: 'same-client-member=member-1',
    });

    expect(membersQueries.updateMemberFace).toHaveBeenCalledTimes(2);
    expect(membersQueries.updateMemberFace).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'member-1',
      clientId,
      expect.objectContaining({
        faceId: sharedFace.faceId,
        photoKey: sharedFace.photoKey,
        deviceSyncStatus: 'pending_sync',
        deviceSyncError: null,
      }),
    );
    expect(membersQueries.updateMemberFace).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'member-1',
      clientId,
      expect.objectContaining({
        faceId: sharedFace.faceId,
        photoKey: sharedFace.photoKey,
        deviceSyncStatus: 'synced',
        deviceSyncError: null,
      }),
    );

    expect(responsiblesQueries.updateResponsibleFace).toHaveBeenCalledWith(
      expect.anything(),
      'resp-1',
      clientId,
      expect.objectContaining({
        deviceSyncStatus: 'synced',
        deviceSyncError: null,
      }),
    );
  });

  it('retorna false quando falha ao baixar foto do R2', async () => {
    r2.getObjectBytes.mockRejectedValue(new Error('R2 indisponível'));

    const result = await service.applySharedFaceFromSameClient(
      userId,
      clientId,
      { type: 'member', id: 'member-1', name: 'Rogerio' },
    );

    expect(result).toBe(false);
    expect(faceSync.syncPersonOnReaders).not.toHaveBeenCalled();
    expect(membersQueries.updateMemberFace).not.toHaveBeenCalled();
  });

  it('persiste sync_failed e propaga erro aos irmãos', async () => {
    faceSync.syncPersonOnReaders.mockResolvedValue({
      deviceSyncStatus: 'sync_failed',
      deviceSyncError: 'Leitor offline',
    });

    const result = await service.applySharedFaceFromSameClient(
      userId,
      clientId,
      { type: 'member', id: 'member-1', name: 'Rogerio' },
    );

    expect(result).toBe(true);
    expect(membersQueries.updateMemberFace).toHaveBeenLastCalledWith(
      expect.anything(),
      'member-1',
      clientId,
      expect.objectContaining({
        deviceSyncStatus: 'sync_failed',
        deviceSyncError: 'Leitor offline',
      }),
    );
    expect(responsiblesQueries.updateResponsibleFace).toHaveBeenCalledWith(
      expect.anything(),
      'resp-1',
      clientId,
      expect.objectContaining({
        deviceSyncStatus: 'sync_failed',
        deviceSyncError: 'Leitor offline',
      }),
    );
  });
});
