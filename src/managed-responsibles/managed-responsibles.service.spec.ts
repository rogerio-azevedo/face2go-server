import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as studentsQueries from '../database/queries/students.queries';
import * as vehicleQueries from '../database/queries/vehicles.queries';
import { ManagedResponsiblesService } from './managed-responsibles.service';

jest.mock('../database/queries/responsibles.queries');
jest.mock('../database/queries/students.queries');
jest.mock('../database/queries/vehicles.queries');
jest.mock('../storage/portrait-image.utils', () => ({
  isPortraitImageUsable: jest.fn().mockResolvedValue(true),
}));

describe('ManagedResponsiblesService.deleteManagedResponsible', () => {
  const user: JwtPayload = {
    sub: 'user-1',
    role: 'responsible',
    clientId: 'client-1',
    responsibleId: 'inviter-1',
  };

  const target = {
    id: 'target-1',
    clientId: 'client-1',
    userId: 'target-user-1',
    name: 'Diego',
    phone: null,
    document: null,
    faceId: 42,
    photoKey: 'responsibles/client-1/target-1/face.jpg',
    pushToken: null,
    isActive: true,
    deviceSyncStatus: 'synced' as const,
    deviceSyncedAt: new Date(),
    deviceSyncError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  let service: ManagedResponsiblesService;
  let faceSync: {
    removePersonFromReaders: jest.Mock;
    syncPersonOnReaders: jest.Mock;
  };
  let lprPlateSync: { removePlateFromAllLprCameras: jest.Mock };
  let accessTimeZone: { resolveResponsibleTimeSections: jest.Mock };
  let r2: { getObjectBytes: jest.Mock };
  let transaction: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    faceSync = {
      removePersonFromReaders: jest.fn().mockResolvedValue(undefined),
      syncPersonOnReaders: jest.fn().mockResolvedValue({
        deviceSyncStatus: 'synced',
        deviceSyncError: null,
      }),
    };
    lprPlateSync = {
      removePlateFromAllLprCameras: jest.fn().mockResolvedValue(undefined),
    };
    accessTimeZone = {
      resolveResponsibleTimeSections: jest.fn().mockResolvedValue([1]),
    };
    r2 = {
      getObjectBytes: jest.fn().mockResolvedValue({ buffer: Buffer.alloc(512) }),
    };
    const txUpdate = jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      }),
    });
    transaction = jest.fn(async (cb) => cb({ update: txUpdate }));

    service = new ManagedResponsiblesService(
      { db: { transaction } } as never,
      { get: jest.fn() } as unknown as ConfigService,
      r2 as never,
      faceSync as never,
      accessTimeZone as never,
      lprPlateSync as never,
      { emit: jest.fn() } as unknown as EventEmitter2,
    );

    jest
      .spyOn(responsiblesQueries, 'responsibleHasParentRelationship')
      .mockImplementation(async (_, responsibleId) => responsibleId === 'inviter-1');
    jest
      .spyOn(responsiblesQueries, 'listHouseholdResponsibleIds')
      .mockResolvedValue(['inviter-1', 'target-1']);
    jest.spyOn(responsiblesQueries, 'getResponsibleById').mockResolvedValue(target);
    jest
      .spyOn(responsiblesQueries, 'shouldPartialUnlinkManagedResponsible')
      .mockResolvedValue(false);
    jest
      .spyOn(vehicleQueries, 'vehicleListByResponsible')
      .mockResolvedValue([{ id: 'vehicle-1', plate: 'ABC1D23' }]);
    jest
      .spyOn(responsiblesQueries, 'deleteAllResponsibleStudentLinks')
      .mockResolvedValue([]);
    jest
      .spyOn(vehicleQueries, 'vehicleDeleteAllForResponsible')
      .mockResolvedValue([]);
    jest.spyOn(responsiblesQueries, 'updateResponsible').mockResolvedValue(target);
    jest
      .spyOn(responsiblesQueries, 'countActiveResponsiblesByUserId')
      .mockResolvedValue(0);
    jest
      .spyOn(studentsQueries, 'listStudentIdsForResponsible')
      .mockResolvedValue(['student-1']);
    jest
      .spyOn(responsiblesQueries, 'deleteResponsibleStudentLinksForStudents')
      .mockResolvedValue([{ id: 'link-1' }]);
    jest.spyOn(responsiblesQueries, 'getResponsibleWithFaceStatus').mockResolvedValue({
      photoKey: target.photoKey,
      faceId: target.faceId,
      deviceSyncStatus: 'synced',
      deviceSyncedAt: new Date(),
      deviceSyncError: null,
    });
    jest.spyOn(responsiblesQueries, 'updateResponsibleFace').mockResolvedValue(undefined);
  });

  it('bloqueia exclusão da própria conta', async () => {
    await expect(
      service.deleteManagedResponsible(user, 'inviter-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bloqueia exclusão por quem não é pai/mãe', async () => {
    jest
      .spyOn(responsiblesQueries, 'responsibleHasParentRelationship')
      .mockResolvedValue(false);

    await expect(
      service.deleteManagedResponsible(user, 'target-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('desativa autorizado criado só para o meu núcleo', async () => {
    const result = await service.deleteManagedResponsible(user, 'target-1');

    expect(result).toEqual({
      removed: true,
      mode: 'deactivated',
      id: 'target-1',
    });
    expect(faceSync.removePersonFromReaders).toHaveBeenCalledWith(
      expect.objectContaining({ faceId: 42, requireAll: true }),
    );
    expect(lprPlateSync.removePlateFromAllLprCameras).toHaveBeenCalled();
    expect(responsiblesQueries.deleteAllResponsibleStudentLinks).toHaveBeenCalled();
    expect(vehicleQueries.vehicleDeleteAllForResponsible).toHaveBeenCalled();
    expect(responsiblesQueries.updateResponsible).toHaveBeenCalledWith(
      expect.anything(),
      'target-1',
      'client-1',
      expect.objectContaining({ isActive: false }),
    );
    expect(
      responsiblesQueries.deleteResponsibleStudentLinksForStudents,
    ).not.toHaveBeenCalled();
  });

  it('desvincula autorizado existente sem remover face nem veículos', async () => {
    jest
      .spyOn(responsiblesQueries, 'shouldPartialUnlinkManagedResponsible')
      .mockResolvedValue(true);

    const result = await service.deleteManagedResponsible(user, 'target-1');

    expect(result).toEqual({
      removed: true,
      mode: 'unlinked',
      id: 'target-1',
    });
    expect(
      responsiblesQueries.deleteResponsibleStudentLinksForStudents,
    ).toHaveBeenCalledWith(expect.anything(), 'target-1', ['student-1']);
    expect(faceSync.removePersonFromReaders).not.toHaveBeenCalled();
    expect(lprPlateSync.removePlateFromAllLprCameras).not.toHaveBeenCalled();
    expect(responsiblesQueries.updateResponsible).not.toHaveBeenCalled();
    expect(faceSync.syncPersonOnReaders).toHaveBeenCalled();
  });

  it('falha no unlink parcial quando não há vínculos com meus alunos', async () => {
    jest
      .spyOn(responsiblesQueries, 'shouldPartialUnlinkManagedResponsible')
      .mockResolvedValue(true);
    jest
      .spyOn(responsiblesQueries, 'deleteResponsibleStudentLinksForStudents')
      .mockResolvedValue([]);

    await expect(
      service.deleteManagedResponsible(user, 'target-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('não desativa users quando ainda restam responsáveis ativos', async () => {
    const txUpdate = jest.fn();
    transaction.mockImplementation(async (cb) =>
      cb({
        update: txUpdate.mockReturnValue({
          set: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(undefined),
          }),
        }),
      }),
    );
    jest
      .spyOn(responsiblesQueries, 'countActiveResponsiblesByUserId')
      .mockResolvedValue(1);

    await service.deleteManagedResponsible(user, 'target-1');

    expect(txUpdate).not.toHaveBeenCalled();
  });
});
