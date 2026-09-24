import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DatabaseService } from '../database/database.service';
import * as clientsQueries from '../database/queries/clients.queries';
import * as membersQueries from '../database/queries/members.queries';
import * as registrationsQueries from '../database/queries/registrations.queries';
import { FaceSyncService } from '../face-sync/face-sync.service';
import { MembersService } from '../members/members.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PersonProfileService } from '../people/person-profile.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { RegistrationsAdminService } from './registrations-admin.service';

function companyAdmin(): JwtPayload {
  return {
    sub: 'admin-1',
    email: 'a@b.c',
    role: 'company_admin',
    contextType: 'company',
    companyId: 'company-1',
  };
}

function companyOperator(): JwtPayload {
  return {
    ...companyAdmin(),
    role: 'company_operator',
    companyUserId: 'cu-1',
  };
}

describe('RegistrationsAdminService lifecycle', () => {
  let service: RegistrationsAdminService;
  let faceSync: {
    removePersonFromReaders: jest.Mock;
    enqueueApprovedRegistrationJob: jest.Mock;
    hasActiveFacialReaders: jest.Mock;
    getReaderSyncCounts: jest.Mock;
  };
  let members: {
    getByRegistrationId: jest.Mock;
    setActiveByRegistrationId: jest.Mock;
    syncProfileFromRegistration: jest.Mock;
    upsertFromApprovedRegistration: jest.Mock;
  };
  let personProfile: { shouldRemoveFaceFromReader: jest.Mock };

  beforeEach(async () => {
    faceSync = {
      removePersonFromReaders: jest.fn().mockResolvedValue({
        removed: 1,
        total: 1,
        failures: [],
      }),
      enqueueApprovedRegistrationJob: jest.fn().mockResolvedValue({}),
      hasActiveFacialReaders: jest.fn().mockResolvedValue(true),
      getReaderSyncCounts: jest.fn().mockResolvedValue({
        total: 3,
        syncedByFace: new Map(),
      }),
    };
    members = {
      getByRegistrationId: jest.fn().mockResolvedValue({ id: 'member-1' }),
      setActiveByRegistrationId: jest
        .fn()
        .mockResolvedValue({ id: 'member-1' }),
      syncProfileFromRegistration: jest.fn().mockResolvedValue(null),
      upsertFromApprovedRegistration: jest.fn().mockResolvedValue(null),
    };
    personProfile = {
      shouldRemoveFaceFromReader: jest.fn().mockResolvedValue(true),
    };

    const module = await Test.createTestingModule({
      providers: [
        RegistrationsAdminService,
        { provide: DatabaseService, useValue: { db: {} } },
        { provide: PermissionsService, useValue: {} },
        {
          provide: R2StorageService,
          useValue: { createPresignedPortraitGetUrl: jest.fn() },
        },
        { provide: FaceSyncService, useValue: faceSync },
        { provide: MembersService, useValue: members },
        { provide: PersonProfileService, useValue: personProfile },
      ],
    }).compile();

    service = module.get(RegistrationsAdminService);
    jest
      .spyOn(registrationsQueries, 'getRegistrationLinkByIdForClient')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('bloqueia exclusão para operador da empresa', async () => {
    await expect(
      service.softDeleteForCompanyUser(companyOperator(), 'client-1', 'reg-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('exclui cadastro aprovado, remove face e desativa o membro', async () => {
    jest.spyOn(clientsQueries, 'getClientById').mockResolvedValue({
      id: 'client-1',
      companyId: 'company-1',
    } as never);
    jest
      .spyOn(registrationsQueries, 'getRegistrationByIdForClient')
      .mockResolvedValue({
        id: 'reg-1',
        clientId: 'client-1',
        status: 'approved',
        isActive: true,
        faceId: 12,
        faceImageKey: 'k',
        name: 'Ana',
      } as never);
    jest
      .spyOn(registrationsQueries, 'setRegistrationActive')
      .mockResolvedValue({
        id: 'reg-1',
        clientId: 'client-1',
        status: 'approved',
        isActive: false,
        faceId: 12,
        name: 'Ana',
      } as never);

    await service.softDeleteForCompanyUser(companyAdmin(), 'client-1', 'reg-1');

    expect(faceSync.removePersonFromReaders).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-1', faceId: 12 }),
    );
    expect(members.setActiveByRegistrationId).toHaveBeenCalledWith(
      'client-1',
      'reg-1',
      false,
    );
  });

  it('restaura cadastro e enfileira resync da face', async () => {
    jest.spyOn(clientsQueries, 'getClientById').mockResolvedValue({
      id: 'client-1',
      companyId: 'company-1',
    } as never);
    const getReg = jest
      .spyOn(registrationsQueries, 'getRegistrationByIdForClient')
      .mockResolvedValue({
        id: 'reg-1',
        clientId: 'client-1',
        status: 'approved',
        isActive: false,
        faceId: 12,
        faceImageKey: 'k',
        name: 'Ana',
      } as never);
    jest
      .spyOn(registrationsQueries, 'setRegistrationActive')
      .mockResolvedValue({
        id: 'reg-1',
        clientId: 'client-1',
        status: 'approved',
        isActive: true,
        faceId: 12,
        faceImageKey: 'k',
        name: 'Ana',
      } as never);

    await service.restoreForCompanyUser(companyAdmin(), 'client-1', 'reg-1');

    expect(members.setActiveByRegistrationId).toHaveBeenCalledWith(
      'client-1',
      'reg-1',
      true,
    );
    expect(faceSync.enqueueApprovedRegistrationJob).toHaveBeenCalledWith(
      'reg-1',
      'client-1',
      'admin-1',
      { resetReaderProgress: true },
    );
    expect(getReg).toHaveBeenCalled();
  });

  it('desbloqueia cadastro, limpa o membro e reenvia a face com blocked=false', async () => {
    jest.spyOn(clientsQueries, 'getClientById').mockResolvedValue({
      id: 'client-1',
      companyId: 'company-1',
    } as never);
    const blockedRow = {
      id: 'reg-1',
      clientId: 'client-1',
      status: 'blocked',
      isActive: true,
      submittedAt: new Date(),
      faceId: 1,
      faceImageKey: 'k',
      name: 'Rogerio',
    };
    const approvedRow = { ...blockedRow, status: 'approved' };
    jest
      .spyOn(registrationsQueries, 'getRegistrationByIdForClient')
      .mockResolvedValueOnce(blockedRow as never)
      .mockResolvedValueOnce(approvedRow as never);
    jest
      .spyOn(registrationsQueries, 'unblockRegistration')
      .mockResolvedValue(approvedRow as never);
    const clearMember = jest
      .spyOn(membersQueries, 'setMemberBlockByRegistrationId')
      .mockResolvedValue(null);
    jest.spyOn(clientsQueries, 'getClientByIdOnly').mockResolvedValue({
      id: 'client-1',
      type: 'company',
    } as never);

    await service.unblockForCompanyUser(companyAdmin(), 'client-1', 'reg-1');

    expect(members.upsertFromApprovedRegistration).toHaveBeenCalledWith(
      approvedRow,
      'company',
    );

    expect(clearMember).toHaveBeenCalledWith({}, 'client-1', 'reg-1', {
      blockReason: null,
      blockedAt: null,
      blockedByUserId: null,
    });
    expect(faceSync.enqueueApprovedRegistrationJob).toHaveBeenCalledWith(
      'reg-1',
      'client-1',
      'admin-1',
      { resetReaderProgress: true, blocked: false },
    );
  });
});
